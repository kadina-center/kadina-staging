import type { Contact, Flow, FlowExecution, FlowStep } from "@prisma/client";
import { getChannelAdapter } from "../channels";
import { prisma } from "../lib/prisma";
import {
  generateAiReply,
  getOrCreateAiSettings,
} from "./ai.service";
import {
  claimContactAiLease,
  releaseContactAiLease,
} from "./ai-contact-lease";
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

/** Grace after wait step before treating missing flow.resume job as stale. */
export const FLOW_WAIT_JOB_GRACE_MS = 2 * 60 * 1000;

/**
 * Non-wait steps run synchronously; if still "running" after this window
 * without a pending flow.resume job, treat as crash-stale (not a durable wait).
 */
export const FLOW_STALE_NON_WAIT_MS = 10 * 60 * 1000;

/**
 * Pure: whether a running execution should be recovered (stopped + pointer cleared).
 * Legitimate durable waits have a pending flow.resume job and are NOT stale.
 */
export function isFlowExecutionStale(opts: {
  currentStepActionType: string | undefined;
  hasPendingResumeJob: boolean;
  executionAgeMs: number;
  waitJobGraceMs?: number;
  staleNonWaitMs?: number;
}): boolean {
  const waitGrace = opts.waitJobGraceMs ?? FLOW_WAIT_JOB_GRACE_MS;
  const staleNonWait = opts.staleNonWaitMs ?? FLOW_STALE_NON_WAIT_MS;

  if (opts.hasPendingResumeJob) return false;

  if (opts.currentStepActionType === "wait") {
    return opts.executionAgeMs > waitGrace;
  }

  return opts.executionAgeMs > staleNonWait;
}

async function hasPendingFlowResumeJob(executionId: string): Promise<boolean> {
  const count = await prisma.scheduledJob.count({
    where: {
      type: "flow.resume",
      status: { in: ["pending", "running"] },
      payloadJson: { contains: executionId },
    },
  });
  return count > 0;
}

/**
 * Fix inconsistent / abandoned flow state for a contact.
 * Safe to call before starting a new flow or reporting active flow info.
 */
export async function reconcileContactFlowState(
  contactId: string
): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return;

  const runningExecutions = await prisma.flowExecution.findMany({
    where: { contactId, status: "running" },
    orderBy: { startedAt: "asc" },
  });

  // Multiple running rows — keep only the pointer target (if valid), stop the rest.
  if (runningExecutions.length > 1) {
    for (const ex of runningExecutions) {
      if (ex.id === contact.activeFlowExecutionId) continue;
      await prisma.flowExecution.update({
        where: { id: ex.id },
        data: { status: "stopped", completedAt: new Date() },
      });
    }
  }

  if (!contact.activeFlowExecutionId) {
    if (runningExecutions.length > 0) {
      await prisma.flowExecution.updateMany({
        where: { contactId, status: "running" },
        data: { status: "stopped", completedAt: new Date() },
      });
    }
    return;
  }

  const pointed = await prisma.flowExecution.findUnique({
    where: { id: contact.activeFlowExecutionId },
  });

  if (!pointed || pointed.status !== "running") {
    await prisma.contact.update({
      where: { id: contactId },
      data: { activeFlowExecutionId: null },
    });
    if (runningExecutions.length > 0) {
      await prisma.flowExecution.updateMany({
        where: { contactId, status: "running" },
        data: { status: "stopped", completedAt: new Date() },
      });
    }
    return;
  }

  const steps = await prisma.flowStep.findMany({
    where: { flowId: pointed.flowId },
    orderBy: { order: "asc" },
  });
  const currentStep = steps[pointed.currentStep];
  const hasResumeJob = await hasPendingFlowResumeJob(pointed.id);
  const ageMs = Date.now() - pointed.startedAt.getTime();

  if (
    isFlowExecutionStale({
      currentStepActionType: currentStep?.actionType,
      hasPendingResumeJob: hasResumeJob,
      executionAgeMs: ageMs,
    })
  ) {
    console.warn(
      `[flow-engine] recovering stale execution=${pointed.id} contact=${contactId} step=${currentStep?.actionType ?? "?"}`
    );
    await stopFlow(contactId);
  }
}

/**
 * Atomically claim the right to start a flow for this contact (PostgreSQL row lock).
 * Returns the new execution or null if another flow is already active.
 */
async function claimFlowExecutionStart(
  contactId: string,
  flowId: string
): Promise<FlowExecution | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Contact" WHERE id = ${contactId} FOR UPDATE`;

      const locked = await tx.contact.findUnique({ where: { id: contactId } });
      if (!locked || locked.activeFlowExecutionId) return null;

      const existingRunning = await tx.flowExecution.findFirst({
        where: { contactId, status: "running" },
      });
      if (existingRunning) return null;

      const execution = await tx.flowExecution.create({
        data: {
          flowId,
          contactId,
          currentStep: 0,
          status: "running",
        },
      });

      const linked = await tx.contact.updateMany({
        where: { id: contactId, activeFlowExecutionId: null },
        data: { activeFlowExecutionId: execution.id },
      });
      if (linked.count !== 1) {
        throw new Error("FLOW_CONTACT_CLAIM_LOST");
      }

      return execution;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FLOW_CONTACT_CLAIM_LOST") {
      return null;
    }
    throw error;
  }
}

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
 * Default AI agent reply path.
 * On low confidence / handoff keywords → pending + stop automation.
 * Per-contact durable lease prevents concurrent default-AI for the same contact.
 */
export async function runDefaultAiAgent(
  contact: Contact,
  customerMessage: string
): Promise<void> {
  const lease = await claimContactAiLease(contact.id);
  if (!lease) {
    console.log(
      `[flow-engine] default AI skipped — contact=${contact.id} AI lease held`
    );
    return;
  }

  try {
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
  } finally {
    await releaseContactAiLease(contact.id, lease.token);
  }
}

export async function startFlow(
  flow: FlowWithSteps | Flow,
  contact: Contact
): Promise<boolean> {
  const steps =
    "steps" in flow && Array.isArray(flow.steps)
      ? flow.steps
      : await prisma.flowStep.findMany({
          where: { flowId: flow.id },
          orderBy: { order: "asc" },
        });

  if (steps.length === 0) {
    console.warn(`[flow-engine] Flow ${flow.id} has no steps — skipped`);
    return false;
  }

  await reconcileContactFlowState(contact.id);

  const execution = await claimFlowExecutionStart(contact.id, flow.id);
  if (!execution) {
    console.log(
      `[flow-engine] start skipped — contact=${contact.id} already has active execution`
    );
    return false;
  }

  void logTimeline({
    contactId: contact.id,
    eventType: TimelineEventType.FLOW_STARTED,
    title: "بدء تدفق آلي",
    description: flow.name,
    actor: actorBot(),
    metadata: { flowId: flow.id, executionId: execution.id },
  });

  await executeStep(execution);
  return true;
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
      // Human handoff — stop automation; do not run subsequent steps.
      await stopFlow(contact.id);
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
  await prisma.flowExecution.updateMany({
    where: { contactId, status: "running" },
    data: { status: "stopped", completedAt: new Date() },
  });

  await prisma.contact.updateMany({
    where: { id: contactId, activeFlowExecutionId: { not: null } },
    data: { activeFlowExecutionId: null },
  });
}

export async function getActiveFlowInfo(contactId: string) {
  await reconcileContactFlowState(contactId);

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

  await reconcileContactFlowState(contact.id);

  const freshContact = await prisma.contact.findUnique({
    where: { id: contact.id },
  });
  if (!freshContact) return;
  if (freshContact.activeFlowExecutionId) return;

  const keywordFlow = await matchKeywordFlow(incomingText, freshContact);
  if (keywordFlow) {
    await startFlow(keywordFlow, freshContact);
    return;
  }

  const aiSettings = await getOrCreateAiSettings();
  if (aiSettings.isActive) {
    try {
      await runDefaultAiAgent(freshContact, incomingText);
    } catch (error) {
      console.error("[flow-engine] default AI agent failed:", error);
      await stopFlow(freshContact.id);
      const conversation = await touchConversation(freshContact.id);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "pending" },
      });
    }
    return;
  }

  const flow = await matchTrigger(incomingText, freshContact);
  if (!flow) return;

  await startFlow(flow, freshContact);
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
