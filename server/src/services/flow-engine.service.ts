import type { Contact, Flow, FlowExecution, FlowStep } from "@prisma/client";
import { getChannelAdapter } from "../channels";
import { prisma } from "../lib/prisma";
import {
  generateAiReply,
  getOrCreateAiSettings,
} from "./ai.service";
import { touchConversation } from "./conversation.service";
import {
  emitConversationUpdated,
  emitNewMessage,
} from "./socket.service";
import { sendTemplateMessage, sendTextMessage } from "./whatsapp.service";
import {
  enqueueScheduledJob,
  registerJobHandler,
} from "./scheduled-jobs.service";
import {
  TimelineEventType,
  actorBot,
  logTimeline,
} from "./timeline.service";

async function resolveContactWhatsAppChannelId(
  contact: Contact
): Promise<string | null> {
  if (contact.whatsAppChannelId) return contact.whatsAppChannelId;
  const conversation = await prisma.conversation.findUnique({
    where: { contactId: contact.id },
    select: { channelId: true },
  });
  return conversation?.channelId ?? null;
}

async function sendChannelText(
  contact: Contact,
  text: string
): Promise<{ waMessageId: string }> {
  if (contact.channel === "whatsapp") {
    const channelId = await resolveContactWhatsAppChannelId(contact);
    return sendTextMessage(contact.phone, text, null, channelId);
  }
  const adapter = getChannelAdapter(contact.channel);
  const to = contact.channelUserId || contact.phone;
  const { platformMessageId } = await adapter.sendMessage(to, text);
  return { waMessageId: platformMessageId };
}

/**
 * No-code Chatbot / Automation Engine
 * -----------------------------------
 * Pattern: Trigger → ordered Actions (FlowSteps).
 *
 * Design notes for later expansion (AI stage / visual builder):
 * - Keep action handlers isolated so new actionTypes can be plugged in.
 * - `wait` uses setTimeout for this solo-project scope; replace with a
 *   durable job scheduler (Bull/Redis/etc.) before production scale.
 * - Visual drag-and-drop (React Flow) can sit on top without changing
 *   the execution semantics of this service.
 */

type FlowWithSteps = Flow & { steps: FlowStep[] };

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseActionValue(raw: string): Record<string, unknown> | string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

async function persistBotOutbound(params: {
  contactId: string;
  phone: string;
  name: string | null;
  type: string;
  content: string;
  waMessageId: string;
  sentByAi?: boolean;
  /** When true, treat as AI rather than flow bot */
  asAi?: boolean;
}) {
  const {
    attributionAi,
    attributionBot,
    attributionToPrismaData,
    messageAttributionFields,
  } = await import("./message-attribution.service");
  const { logAudit } = await import("./audit.service");

  const attr = params.asAi
    ? attributionAi("AI")
    : attributionBot("Bot");
  // Prefer explicit sentByAi when provided
  if (params.sentByAi === false) {
    attr.sentByAi = false;
  } else if (params.sentByAi === true) {
    attr.sentByAi = true;
  }

  const message = await prisma.message.create({
    data: {
      contactId: params.contactId,
      direction: "outbound",
      type: params.type,
      content: params.content,
      status: "sent",
      waMessageId: params.waMessageId,
      ...attributionToPrismaData(attr),
    },
  });

  void logAudit({
    actorId: null,
    actorType: params.asAi ? "AI" : "BOT",
    performedByName: attr.createdByName,
    performedByRole: attr.createdByRole ?? null,
    action: "SEND",
    entityType: "MESSAGE",
    entityId: message.id,
    metadata: {
      messageId: message.id,
      contactId: params.contactId,
      type: params.type,
      senderType: attr.senderType,
      createdByName: attr.createdByName,
      automated: true,
    },
  });

  const conversation = await touchConversation(params.contactId);
  const attrFields = messageAttributionFields(message);

  emitNewMessage({
    message: { ...message, ...attrFields },
    contact: {
      id: params.contactId,
      phone: params.phone,
      name: params.name,
      lastMessageAt: conversation.lastMessageAt,
    },
  });

  emitConversationUpdated({
    id: conversation.id,
    contactId: conversation.contactId,
    status: conversation.status,
    assignedToId: conversation.assignedToId,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    contact: {
      id: conversation.contact.id,
      phone: conversation.contact.phone,
      name: conversation.contact.name,
      lastMessageAt: conversation.contact.lastMessageAt,
      createdAt: conversation.contact.createdAt,
      lastMessage: {
        id: message.id,
        content: message.content,
        direction: message.direction,
        createdAt: message.createdAt,
        status: message.status,
        ...attrFields,
      },
    },
    assignedTo: conversation.assignedTo,
    tags: conversation.tags,
  });

  return message;
}

/**
 * Find the best matching active Flow for an inbound message.
 * Priority: keyword matches first, then any_message as fallback.
 * Does not start a new flow if the contact already has an active execution.
 */
export async function matchTrigger(
  incomingText: string,
  contact: Contact
): Promise<FlowWithSteps | null> {
  if (contact.activeFlowExecutionId) {
    // Finish / continue the current execution — do not stack another flow.
    return null;
  }

  const flows = await prisma.flow.findMany({
    where: { isActive: true },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  const normalized = normalizeText(incomingText || "");

  const keywordMatch = flows.find((flow) => {
    if (flow.triggerType !== "keyword") return false;
    if (!flow.triggerValue) return false;
    return normalized.includes(normalizeText(flow.triggerValue));
  });
  if (keywordMatch) return keywordMatch;

  // When the AI agent is the default responder, skip any_message flows here
  // (maybeStartFlowForInbound routes to AI instead).
  const aiSettings = await getOrCreateAiSettings();
  if (aiSettings.isActive) return null;

  // any_message is the default catch-all (checked after keywords)
  const anyMatch = flows.find((flow) => flow.triggerType === "any_message");
  if (anyMatch) return anyMatch;

  // no_response_24h is intended for a scheduler, not inbound matching
  return null;
}

/** Keyword-only match (used before AI default agent) */
export async function matchKeywordFlow(
  incomingText: string,
  contact: Contact
): Promise<FlowWithSteps | null> {
  if (contact.activeFlowExecutionId) return null;

  const flows = await prisma.flow.findMany({
    where: { isActive: true, triggerType: "keyword" },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  const normalized = normalizeText(incomingText || "");
  return (
    flows.find(
      (flow) =>
        !!flow.triggerValue &&
        normalized.includes(normalizeText(flow.triggerValue))
    ) ?? null
  );
}

/**
 * Default AI agent reply path (not Copilot).
 * On low confidence / handoff keywords → pending + stop automation.
 */
export async function runDefaultAiAgent(
  contact: Contact,
  customerMessage: string
): Promise<void> {
  const history = await prisma.message.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const result = await generateAiReply(customerMessage, history);

  if (result.shouldHandoff) {
    await stopFlow(contact.id);
    const conversation = await touchConversation(contact.id);
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "pending" },
      include: { contact: true, assignedTo: true, tags: true },
    });
    emitConversationUpdated({
      ...updated,
      contact: { ...updated.contact, lastMessage: null },
    });

    try {
      const { waMessageId } = await sendChannelText(
        contact,
        "شكرًا لك. سأحوّل محادثتك إلى أحد موظفينا للمتابعة."
      );
      await persistBotOutbound({
        contactId: contact.id,
        phone: contact.phone,
        name: contact.name,
        type: "text",
        content: "شكرًا لك. سأحوّل محادثتك إلى أحد موظفينا للمتابعة.",
        waMessageId,
        sentByAi: true,
        asAi: true,
      });
    } catch (error) {
      console.error("[flow-engine] AI handoff notice failed:", error);
    }
    return;
  }

  if (!result.reply) return;

  const { waMessageId } = await sendChannelText(contact, result.reply);
  await persistBotOutbound({
    contactId: contact.id,
    phone: contact.phone,
    name: contact.name,
    type: "text",
    content: result.reply,
    waMessageId,
    sentByAi: true,
    asAi: true,
  });
}

export async function startFlow(
  flow: FlowWithSteps | Flow,
  contact: Contact
): Promise<void> {
  const steps =
    "steps" in flow && Array.isArray(flow.steps)
      ? flow.steps
      : await prisma.flowStep.findMany({
          where: { flowId: flow.id },
          orderBy: { order: "asc" },
        });

  if (steps.length === 0) {
    console.warn(`[flow-engine] Flow ${flow.id} has no steps — skipped`);
    return;
  }

  const execution = await prisma.flowExecution.create({
    data: {
      flowId: flow.id,
      contactId: contact.id,
      currentStep: 0,
      status: "running",
    },
  });

  await prisma.contact.update({
    where: { id: contact.id },
    data: { activeFlowExecutionId: execution.id },
  });

  void logTimeline({
    contactId: contact.id,
    eventType: TimelineEventType.FLOW_STARTED,
    title: "بدء تدفق آلي",
    description: flow.name,
    actor: actorBot(),
    metadata: { flowId: flow.id, executionId: execution.id },
  });

  await executeStep(execution);
}

async function completeExecution(executionId: string, contactId: string) {
  const execution = await prisma.flowExecution.findUnique({
    where: { id: executionId },
  });

  const flow = execution
    ? await prisma.flow.findUnique({
        where: { id: execution.flowId },
        select: { id: true, name: true },
      })
    : null;

  await prisma.flowExecution.update({
    where: { id: executionId },
    data: { status: "completed", completedAt: new Date() },
  });
  await prisma.contact.update({
    where: { id: contactId },
    data: { activeFlowExecutionId: null },
  });

  void logTimeline({
    contactId,
    eventType: TimelineEventType.FLOW_COMPLETED,
    title: "اكتمال تدفق آلي",
    description: flow?.name ?? undefined,
    actor: actorBot(),
    metadata: {
      flowId: execution?.flowId ?? null,
      executionId,
    },
  });
}

async function runAction(
  step: FlowStep,
  contact: Contact
): Promise<void> {
  const value = parseActionValue(step.actionValue);

  switch (step.actionType) {
    case "send_text": {
      const text =
        typeof value === "string"
          ? value
          : String((value as { text?: string }).text || "");
      if (!text) return;
      const { waMessageId } = await sendChannelText(contact, text);
      await persistBotOutbound({
        contactId: contact.id,
        phone: contact.phone,
        name: contact.name,
        type: "text",
        content: text,
        waMessageId,
      });
      return;
    }

    case "send_template": {
      let templateId = "";
      let params: string[] = [];
      if (typeof value === "string") {
        templateId = value;
      } else {
        templateId = String(
          (value as { templateId?: string }).templateId || ""
        );
        const rawParams = (value as { params?: string[] }).params;
        params = Array.isArray(rawParams) ? rawParams : [];
      }
      if (!templateId) return;

      const template = await prisma.template.findUnique({
        where: { id: templateId },
      });
      if (!template || template.status !== "approved") {
        throw new Error(
          `Template ${templateId} is missing or not approved`
        );
      }

      const channelId = await resolveContactWhatsAppChannelId(contact);
      const { waMessageId } = await sendTemplateMessage(
        contact.phone,
        template.name,
        template.language,
        params,
        channelId
      );

      const filled = params.length
        ? params.reduce(
            (text, p, i) => text.replace(`{{${i + 1}}}`, p),
            template.bodyText
          )
        : template.bodyText;

      await persistBotOutbound({
        contactId: contact.id,
        phone: contact.phone,
        name: contact.name,
        type: "template",
        content: filled,
        waMessageId,
      });
      return;
    }

    case "assign_to_user": {
      const userId =
        typeof value === "string"
          ? value
          : String((value as { userId?: string }).userId || "");
      if (!userId) return;
      const conversation = await touchConversation(contact.id);
      const previousAssignedToId = conversation.assignedToId;
      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          assignedToId: userId,
          assignedAt: new Date(),
          assignedByUserId: null,
        } as import("@prisma/client").Prisma.ConversationUncheckedUpdateInput,
        include: {
          contact: true,
          assignedTo: true,
          tags: true,
        },
      });
      emitConversationUpdated(
        {
          ...updated,
          contact: {
            ...updated.contact,
            lastMessage: null,
          },
        },
        previousAssignedToId
      );
      return;
    }

    case "add_tag": {
      const tagId =
        typeof value === "string"
          ? value
          : String((value as { tagId?: string }).tagId || "");
      if (!tagId) return;
      const conversation = await touchConversation(contact.id);
      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { tags: { connect: { id: tagId } } },
        include: {
          contact: true,
          assignedTo: true,
          tags: true,
        },
      });
      emitConversationUpdated({
        ...updated,
        contact: {
          ...updated.contact,
          lastMessage: null,
        },
      });
      return;
    }

    case "set_status": {
      const status =
        typeof value === "string"
          ? value
          : String((value as { status?: string }).status || "");
      if (!["open", "pending", "closed"].includes(status)) return;
      const conversation = await touchConversation(contact.id);
      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status },
        include: {
          contact: true,
          assignedTo: true,
          tags: true,
        },
      });
      emitConversationUpdated({
        ...updated,
        contact: {
          ...updated.contact,
          lastMessage: null,
        },
      });
      return;
    }

    case "wait": {
      // Durable wait is handled in executeStep (enqueueScheduledJob).
      return;
    }

    case "ai_agent_reply": {
      const history = await prisma.message.findMany({
        where: { contactId: contact.id },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      const lastInbound =
        [...history].reverse().find((m) => m.direction === "inbound")
          ?.content ||
        (typeof value === "string" ? value : "") ||
        "";

      const result = await generateAiReply(lastInbound, history);

      if (result.shouldHandoff) {
        await stopFlow(contact.id);
        const conversation = await touchConversation(contact.id);
        const updated = await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: "pending" },
          include: { contact: true, assignedTo: true, tags: true },
        });
        emitConversationUpdated({
          ...updated,
          contact: { ...updated.contact, lastMessage: null },
        });
        return;
      }

      if (!result.reply) return;

      const { waMessageId } = await sendChannelText(contact, result.reply);
      await persistBotOutbound({
        contactId: contact.id,
        phone: contact.phone,
        name: contact.name,
        type: "text",
        content: result.reply,
        waMessageId,
        sentByAi: true,
        asAi: true,
      });
      return;
    }

    default:
      console.warn(`[flow-engine] Unknown actionType: ${step.actionType}`);
  }
}

/**
 * Execute the current step, then advance (or complete).
 */
export async function executeStep(execution: FlowExecution): Promise<void> {
  const fresh = await prisma.flowExecution.findUnique({
    where: { id: execution.id },
  });
  if (!fresh || fresh.status !== "running") return;

  const contact = await prisma.contact.findUnique({
    where: { id: fresh.contactId },
  });
  if (!contact) return;

  // Human takeover may have cleared activeFlowExecutionId
  if (contact.activeFlowExecutionId !== fresh.id) return;

  const steps = await prisma.flowStep.findMany({
    where: { flowId: fresh.flowId },
    orderBy: { order: "asc" },
  });

  const step = steps[fresh.currentStep];
  if (!step) {
    await completeExecution(fresh.id, fresh.contactId);
    return;
  }

  // Durable wait via PostgreSQL ScheduledJob (survives process restart).
  // Redis/BullMQ is optional for multi-instance; see docs/BACKUP.md TODO.
  if (step.actionType === "wait") {
    let seconds = 0;
    try {
      const parsed = JSON.parse(step.actionValue) as { seconds?: number };
      if (typeof parsed?.seconds === "number") seconds = parsed.seconds;
      else seconds = Number(step.actionValue) || 0;
    } catch {
      seconds = Number(step.actionValue) || 0;
    }
    const ms = Math.min(Math.max(seconds, 0), 86_400) * 1000; // cap 24h
    await enqueueScheduledJob(
      "flow.resume",
      new Date(Date.now() + Math.max(ms, 1_000)),
      { executionId: fresh.id, afterStep: fresh.currentStep }
    );
    return;
  }

  try {
    await runAction(step, contact);
  } catch (error) {
    console.error(
      `[flow-engine] Step ${step.id} failed:`,
      error instanceof Error ? error.message : error
    );
    // Continue to next step even on failure (avoid stuck executions)
  }

  // Re-check: stopFlow may have run during wait / send
  const stillActive = await prisma.flowExecution.findUnique({
    where: { id: fresh.id },
  });
  if (!stillActive || stillActive.status !== "running") return;

  const contactStill = await prisma.contact.findUnique({
    where: { id: fresh.contactId },
  });
  if (!contactStill || contactStill.activeFlowExecutionId !== fresh.id) {
    return;
  }

  const nextIndex = fresh.currentStep + 1;
  if (nextIndex >= steps.length) {
    await completeExecution(fresh.id, fresh.contactId);
    return;
  }

  const advanced = await prisma.flowExecution.update({
    where: { id: fresh.id },
    data: { currentStep: nextIndex },
  });

  await executeStep(advanced);
}

/**
 * Stop any running automation for a contact (human agent takeover).
 */
export async function stopFlow(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });
  if (!contact?.activeFlowExecutionId) {
    await prisma.flowExecution.updateMany({
      where: { contactId, status: "running" },
      data: { status: "stopped", completedAt: new Date() },
    });
    return;
  }

  await prisma.flowExecution.updateMany({
    where: {
      id: contact.activeFlowExecutionId,
      status: "running",
    },
    data: { status: "stopped", completedAt: new Date() },
  });

  await prisma.contact.update({
    where: { id: contactId },
    data: { activeFlowExecutionId: null },
  });
}

export async function getActiveFlowInfo(contactId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { activeFlowExecutionId: true },
  });

  if (!contact?.activeFlowExecutionId) {
    return { active: false as const };
  }

  const execution = await prisma.flowExecution.findUnique({
    where: { id: contact.activeFlowExecutionId },
  });

  if (!execution || execution.status !== "running") {
    return { active: false as const };
  }

  const flow = await prisma.flow.findUnique({
    where: { id: execution.flowId },
  });

  return {
    active: true as const,
    execution,
    flow,
  };
}

/**
 * Entry point used by the webhook after an inbound message is saved.
 * Skips automation when a human agent already owns the conversation.
 *
 * Order: keyword Flow → (optional) default AI agent → any_message Flow.
 */
export async function maybeStartFlowForInbound(
  contact: Contact,
  incomingText: string,
  assignedToId: string | null | undefined
): Promise<void> {
  // Critical rule: never bot-reply on a human-assigned conversation
  if (assignedToId) return;
  if (contact.activeFlowExecutionId) return;

  const keywordFlow = await matchKeywordFlow(incomingText, contact);
  if (keywordFlow) {
    await startFlow(keywordFlow, contact);
    return;
  }

  const aiSettings = await getOrCreateAiSettings();
  if (aiSettings.isActive) {
    try {
      await runDefaultAiAgent(contact, incomingText);
    } catch (error) {
      console.error("[flow-engine] default AI agent failed:", error);
      await stopFlow(contact.id);
      const conversation = await touchConversation(contact.id);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "pending" },
      });
    }
    return;
  }

  const flow = await matchTrigger(incomingText, contact);
  if (!flow) return;

  await startFlow(flow, contact);
}

/**
 * Registers durable flow.wait resume handler with the PostgreSQL job runner.
 * Call once at server boot (after startScheduledJobRunner imports are ready).
 */
export function registerFlowJobHandlers(): void {
  registerJobHandler(
    "flow.resume",
    async (payload: { executionId?: string; afterStep?: number }) => {
      const executionId = payload?.executionId;
      const afterStep = payload?.afterStep;
      if (!executionId || typeof afterStep !== "number") {
        throw new Error("flow.resume payload missing executionId/afterStep");
      }

      const execution = await prisma.flowExecution.findUnique({
        where: { id: executionId },
      });
      if (!execution || execution.status !== "running") return;
      if (execution.currentStep !== afterStep) return;

      const contact = await prisma.contact.findUnique({
        where: { id: execution.contactId },
      });
      if (!contact || contact.activeFlowExecutionId !== execution.id) return;

      const steps = await prisma.flowStep.findMany({
        where: { flowId: execution.flowId },
        orderBy: { order: "asc" },
      });

      const nextIndex = afterStep + 1;
      if (nextIndex >= steps.length) {
        await completeExecution(execution.id, execution.contactId);
        return;
      }

      const advanced = await prisma.flowExecution.update({
        where: { id: execution.id },
        data: { currentStep: nextIndex },
      });
      await executeStep(advanced);
    }
  );
}
