import type { Request, Response } from "express";
import { getChannelAdapter } from "../channels";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import { assertCanAccessContact } from "../services/conversation-access.service";
import {
  markFirstHumanResponse,
  touchLastAgent,
  touchConversation,
} from "../services/conversation.service";
import { stopFlow } from "../services/flow-engine.service";
import { saveMediaBuffer } from "../services/media-storage.service";
import {
  attributionAuditMeta,
  attributionFromRequest,
  attributionToPrismaData,
  messageAttributionFields,
  type MessageAttribution,
} from "../services/message-attribution.service";
import {
  TimelineEventType,
  actorFromUser,
  logTimeline,
} from "../services/timeline.service";
import {
  emitConversationUpdated,
  emitMessageDeleted,
  emitMessageUpdated,
  emitNewMessage,
} from "../services/socket.service";
import {
  mimeToMediaType,
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  uploadMedia,
} from "../services/whatsapp.service";
import {
  publicSendErrorPayload,
  toWhatsAppSendError,
} from "../services/whatsapp-send-error";

type OutboundMessageRow = {
  id: string;
  contactId: string;
  direction: string;
  type: string;
  content: string;
  status: string;
  waMessageId: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  caption?: string | null;
  sentByAi?: boolean;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  createdByAvatar?: string | null;
  senderType?: string | null;
  replyToMessageId?: string | null;
  replyToWaMessageId?: string | null;
  errorMessage?: string | null;
  metaPayload?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt?: Date | null;
};

function emitAfterMessage(
  message: OutboundMessageRow,
  contact: { id: string; phone: string; name: string | null },
  conversation: Awaited<ReturnType<typeof touchConversation>>,
  opts?: { actorUser?: import("../middleware/auth").AuthUser | null; retried?: boolean }
) {
  const attr = messageAttributionFields(message);
  emitNewMessage({
    message: {
      ...message,
      ...attr,
    },
    contact: {
      id: contact.id,
      phone: contact.phone,
      name: contact.name,
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
    pinned: conversation.pinned,
    archived: conversation.archived,
    unreadCount: conversation.unreadCount,
    lastReadAt: conversation.lastReadAt,
    contact: {
      id: conversation.contact.id,
      phone: conversation.contact.phone,
      name: conversation.contact.name,
      channel: conversation.contact.channel,
      channelUserId: conversation.contact.channelUserId,
      lastMessageAt: conversation.contact.lastMessageAt,
      createdAt: conversation.contact.createdAt,
      crmStatus: conversation.contact.crmStatus,
      customNotes: conversation.contact.customNotes,
      lastMessage: {
        id: message.id,
        content: message.content,
        direction: message.direction,
        createdAt: message.createdAt,
        status: message.status,
        ...attr,
      },
    },
    assignedTo: conversation.assignedTo,
    tags: conversation.tags,
  });

  const failed = message.status === "failed";
  // Prefer MESSAGE_FAILED when status is failed (including retry that still fails).
  const eventType = failed
    ? TimelineEventType.MESSAGE_FAILED
    : opts?.retried
      ? TimelineEventType.MESSAGE_RETRIED
      : TimelineEventType.MESSAGE_SENT;
  void logTimeline({
    contactId: contact.id,
    conversationId: conversation.id,
    eventType,
    title: failed
      ? "فشل إرسال رسالة"
      : opts?.retried
        ? "إعادة إرسال رسالة"
        : "إرسال رسالة",
    description: (message.content || "").slice(0, 200),
    actor: actorFromUser(opts?.actorUser),
    metadata: {
      messageId: message.id,
      senderType: attr.senderType,
      status: message.status,
      type: message.type,
      errorMessage: message.errorMessage ?? null,
    },
  });
}

function auditMessageSent(
  req: Request,
  messageId: string,
  contactId: string,
  type: string,
  attr: MessageAttribution,
  extra?: Record<string, unknown> & { failed?: boolean }
) {
  const failed = Boolean(extra?.failed);
  logAuditFromRequest(req, {
    action: AuditAction.SEND,
    entityType: AuditEntity.MESSAGE,
    entityId: messageId,
    status: failed ? "FAILED" : "SUCCESS",
    metadata: {
      messageId,
      contactId,
      type,
      ...attributionAuditMeta(attr),
      ...extra,
    },
  });
}

function resolveOutboundError(req: Request, sendError: unknown) {
  const wa = toWhatsAppSendError(sendError);
  const isAdmin = req.user?.role === "admin";
  const publicPayload = publicSendErrorPayload(sendError, isAdmin);
  console.error(
    `[messages] send failed code=${wa.code} meta=${wa.metaCode ?? "-"}:`,
    wa.message
  );
  return {
    code: publicPayload.code,
    /** Safe Arabic text stored on the message row (visible in inbox). */
    errorMessage: wa.agentMessage,
    /** Role-aware API error string. */
    apiError: publicPayload.error,
    technicalMessage: isAdmin ? publicPayload.technicalMessage : undefined,
  };
}

export async function sendMessage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { contactId, text, replyToMessageId } = req.body as {
      contactId?: string;
      text?: string;
      replyToMessageId?: string;
    };

    if (!contactId || typeof contactId !== "string") {
      res.status(400).json({ error: "contactId is required" });
      return;
    }

    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, contactId))) return;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (contact.optedOut) {
      res.status(403).json({
        error: "هذا الرقم ألغى الاشتراك — لا يمكن إرسال رسائل إليه",
      });
      return;
    }

    let replyToId: string | null = null;
    let replyToWaMessageId: string | null = null;
    if (replyToMessageId) {
      const replyTarget = await prisma.message.findFirst({
        where: { id: replyToMessageId, contactId: contact.id },
      });
      if (!replyTarget) {
        res.status(404).json({ error: "replyToMessageId not found" });
        return;
      }
      replyToId = replyTarget.id;
      replyToWaMessageId = replyTarget.waMessageId;
    }

    // Human agent reply stops automation immediately
    await stopFlow(contact.id);

    const recipient = contact.channelUserId || contact.phone;
    const content = text.trim();
    const attr = await attributionFromRequest(req.user);
    const attrData = attributionToPrismaData(attr);

    const conversationChannel = await prisma.conversation.findUnique({
      where: { contactId: contact.id },
      select: { channelId: true },
    });
    const whatsAppChannelId =
      conversationChannel?.channelId || contact.whatsAppChannelId || null;

    try {
      let platformMessageId: string;
      if (contact.channel === "whatsapp") {
        const result = await sendTextMessage(
          contact.phone,
          content,
          replyToWaMessageId,
          whatsAppChannelId
        );
        platformMessageId = result.waMessageId;
      } else {
        const adapter = getChannelAdapter(contact.channel);
        const result = await adapter.sendMessage(recipient, content);
        platformMessageId = result.platformMessageId;
      }

      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: "text",
          content,
          status: "sent",
          waMessageId: platformMessageId,
          replyToMessageId: replyToId,
          replyToWaMessageId,
          ...attrData,
        },
      });

      auditMessageSent(req, message.id, contact.id, "text", attr);

      const conversation = await touchConversation(contact.id);
      await markFirstHumanResponse(contact.id);
      touchLastAgent(contact.id, req.user?.id);
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(201).json(message);
    } catch (sendError) {
      const resolved = resolveOutboundError(req, sendError);
      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: "text",
          content,
          status: "failed",
          errorMessage: resolved.errorMessage,
          metaPayload: JSON.stringify({ code: resolved.code }),
          replyToMessageId: replyToId,
          replyToWaMessageId,
          ...attrData,
        },
      });
      auditMessageSent(req, message.id, contact.id, "text", attr, {
        failed: true,
        errorMessage: resolved.errorMessage,
        code: resolved.code,
      });
      const conversation = await touchConversation(contact.id);
      // Do not touchLastAgent / attribution on failed sends.
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(502).json({
        error: resolved.apiError,
        code: resolved.code,
        ...(resolved.technicalMessage
          ? { technicalMessage: resolved.technicalMessage }
          : {}),
        message,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send message";
    console.error("[messages] send error:", message);
    res.status(500).json({ error: message });
  }
}

export async function retryFailedMessage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { messageId } = req.params;

    const failed = await prisma.message.findUnique({
      where: { id: messageId },
      include: { contact: true },
    });

    if (!failed) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, failed.contactId))) return;

    if (failed.status !== "failed") {
      res.status(400).json({ error: "Only failed messages can be retried" });
      return;
    }

    if (failed.direction !== "outbound") {
      res.status(400).json({ error: "Only outbound messages can be retried" });
      return;
    }

    const contact = failed.contact;
    await stopFlow(contact.id);

    try {
      let platformMessageId: string;

      const conversationChannel = await prisma.conversation.findUnique({
        where: { contactId: contact.id },
        select: { channelId: true },
      });
      const whatsAppChannelId =
        conversationChannel?.channelId || contact.whatsAppChannelId || null;

      if (failed.type === "text" || !failed.type) {
        if (contact.channel === "whatsapp") {
          const result = await sendTextMessage(
            contact.phone,
            failed.content,
            failed.replyToWaMessageId,
            whatsAppChannelId
          );
          platformMessageId = result.waMessageId;
        } else {
          const adapter = getChannelAdapter(contact.channel);
          const result = await adapter.sendMessage(
            contact.channelUserId || contact.phone,
            failed.content
          );
          platformMessageId = result.platformMessageId;
        }
      } else {
        res.status(400).json({
          error: `Retry not supported for message type: ${failed.type}`,
        });
        return;
      }

      const message = await prisma.message.update({
        where: { id: failed.id },
        data: {
          status: "sent",
          waMessageId: platformMessageId,
          errorMessage: null,
        },
      });

      logAuditFromRequest(req, {
        action: AuditAction.RETRY,
        entityType: AuditEntity.MESSAGE,
        entityId: message.id,
        status: "SUCCESS",
        oldValues: { status: "failed" },
        newValues: { status: "sent" },
        metadata: {
          messageId: message.id,
          contactId: contact.id,
          type: failed.type,
          originalCreatedByUserId: failed.createdByUserId,
          originalCreatedByName: failed.createdByName,
          originalSenderType: failed.senderType,
          success: true,
        },
      });

      const conversation = await touchConversation(contact.id);
      await markFirstHumanResponse(contact.id);
      touchLastAgent(contact.id, req.user?.id);
      emitAfterMessage(message, contact, conversation, {
        actorUser: req.user,
        retried: true,
      });
      res.json(message);
    } catch (sendError) {
      const resolved = resolveOutboundError(req, sendError);

      let retryCount = 1;
      try {
        const meta = failed.metaPayload
          ? (JSON.parse(failed.metaPayload) as { retryCount?: number })
          : {};
        retryCount = (meta.retryCount || 0) + 1;
      } catch {
        retryCount = 1;
      }

      const message = await prisma.message.update({
        where: { id: failed.id },
        data: {
          status: "failed",
          errorMessage: resolved.errorMessage,
          metaPayload: JSON.stringify({ retryCount, code: resolved.code }),
        },
      });

      logAuditFromRequest(req, {
        action: AuditAction.RETRY,
        entityType: AuditEntity.MESSAGE,
        entityId: message.id,
        status: "FAILED",
        metadata: {
          messageId: message.id,
          contactId: contact.id,
          type: failed.type,
          success: false,
          error: resolved.errorMessage,
          code: resolved.code,
          retryCount,
        },
      });

      if (retryCount >= 5) {
        const { logDeadLetter } = await import("../services/error-log.service");
        void logDeadLetter({
          originalType: "message.retry",
          payload: { messageId: failed.id, contactId: failed.contactId },
          errorMessage: resolved.errorMessage,
          retryCount,
        });
      }

      const conversation = await touchConversation(contact.id);
      emitAfterMessage(message, contact, conversation, {
        actorUser: req.user,
        retried: true,
      });
      res.status(502).json({
        error: resolved.apiError,
        code: resolved.code,
        ...(resolved.technicalMessage
          ? { technicalMessage: resolved.technicalMessage }
          : {}),
        message,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to retry message";
    console.error("[messages] retry error:", message);
    res.status(500).json({ error: message });
  }
}

export async function sendInteractive(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const {
      contactId,
      interactiveType,
      bodyText,
      buttons,
      buttonLabel,
      sections,
    } = req.body as {
      contactId?: string;
      interactiveType?: "buttons" | "list";
      bodyText?: string;
      buttons?: Array<{ id: string; title: string }>;
      buttonLabel?: string;
      sections?: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };

    if (!contactId || !bodyText?.trim()) {
      res.status(400).json({ error: "contactId and bodyText are required" });
      return;
    }

    if (interactiveType !== "buttons" && interactiveType !== "list") {
      res
        .status(400)
        .json({ error: "interactiveType must be buttons or list" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, contactId))) return;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (contact.optedOut) {
      res.status(403).json({
        error: "هذا الرقم ألغى الاشتراك — لا يمكن إرسال رسائل إليه",
      });
      return;
    }

    if (contact.channel !== "whatsapp") {
      res.status(400).json({
        error: "الرسائل التفاعلية متاحة حاليًا على واتساب فقط",
      });
      return;
    }

    await stopFlow(contact.id);

    const metaPayload = JSON.stringify({
      interactiveType,
      bodyText: bodyText.trim(),
      buttons: buttons ?? null,
      buttonLabel: buttonLabel ?? null,
      sections: sections ?? null,
    });
    const attr = await attributionFromRequest(req.user);
    const attrData = attributionToPrismaData(attr);

    const conversationChannel = await prisma.conversation.findUnique({
      where: { contactId: contact.id },
      select: { channelId: true },
    });
    const whatsAppChannelId =
      conversationChannel?.channelId || contact.whatsAppChannelId || null;

    try {
      let waMessageId: string;
      let content: string;

      if (interactiveType === "buttons") {
        if (!Array.isArray(buttons) || buttons.length === 0) {
          res.status(400).json({ error: "buttons array is required" });
          return;
        }
        const result = await sendInteractiveButtons(
          contact.phone,
          bodyText.trim(),
          buttons,
          whatsAppChannelId
        );
        waMessageId = result.waMessageId;
        content = `${bodyText.trim()} [${buttons.map((b) => b.title).join(" | ")}]`;
      } else {
        if (!buttonLabel?.trim() || !Array.isArray(sections) || !sections.length) {
          res
            .status(400)
            .json({ error: "buttonLabel and sections are required for list" });
          return;
        }
        const result = await sendInteractiveList(
          contact.phone,
          bodyText.trim(),
          buttonLabel.trim(),
          sections,
          whatsAppChannelId
        );
        waMessageId = result.waMessageId;
        content = `${bodyText.trim()} [list]`;
      }

      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: "interactive",
          content,
          status: "sent",
          waMessageId,
          metaPayload,
          ...attrData,
        },
      });

      auditMessageSent(req, message.id, contact.id, "interactive", attr, {
        interactiveType,
      });

      const conversation = await touchConversation(contact.id);
      await markFirstHumanResponse(contact.id);
      touchLastAgent(contact.id, req.user?.id);
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(201).json(message);
    } catch (sendError) {
      const resolved = resolveOutboundError(req, sendError);
      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: "interactive",
          content: bodyText.trim(),
          status: "failed",
          errorMessage: resolved.errorMessage,
          metaPayload,
          ...attrData,
        },
      });
      auditMessageSent(req, message.id, contact.id, "interactive", attr, {
        failed: true,
        errorMessage: resolved.errorMessage,
        code: resolved.code,
        interactiveType,
      });
      const conversation = await touchConversation(contact.id);
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(502).json({
        error: resolved.apiError,
        code: resolved.code,
        ...(resolved.technicalMessage
          ? { technicalMessage: resolved.technicalMessage }
          : {}),
        message,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to send interactive message";
    console.error("[messages] interactive error:", message);
    res.status(500).json({ error: message });
  }
}

export async function sendMedia(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const contactId = req.body.contactId as string | undefined;
    const caption = (req.body.caption as string | undefined)?.trim() || undefined;
    const file = req.file;

    if (!contactId) {
      res.status(400).json({ error: "contactId is required" });
      return;
    }
    if (!file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, contactId))) return;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (contact.optedOut) {
      res.status(403).json({
        error: "هذا الرقم ألغى الاشتراك — لا يمكن إرسال رسائل إليه",
      });
      return;
    }

    if (contact.channel !== "whatsapp") {
      res.status(400).json({
        error: "إرسال الوسائط متاح حاليًا على واتساب فقط",
      });
      return;
    }

    await stopFlow(contact.id);

    const mimeType = file.mimetype || "application/octet-stream";
    const mediaType = mimeToMediaType(mimeType);
    const attr = await attributionFromRequest(req.user);
    const attrData = attributionToPrismaData(attr);

    const conversationChannel = await prisma.conversation.findUnique({
      where: { contactId: contact.id },
      select: { channelId: true },
    });
    const whatsAppChannelId =
      conversationChannel?.channelId || contact.whatsAppChannelId || null;

    // Keep a local copy for the inbox UI (and upload that path to Meta)
    const local = saveMediaBuffer(file.buffer, mimeType, file.originalname);
    const content = caption || file.originalname || `[${mediaType}]`;

    try {
      const { mediaId } = await uploadMedia(
        local.absolutePath,
        mimeType,
        whatsAppChannelId
      );
      const { waMessageId } = await sendMediaMessage(
        contact.phone,
        mediaId,
        mediaType,
        caption,
        file.originalname,
        whatsAppChannelId
      );

      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: mediaType,
          content,
          status: "sent",
          waMessageId,
          mediaUrl: local.publicPath,
          mediaMimeType: mimeType,
          caption: caption ?? null,
          ...attrData,
        },
      });

      auditMessageSent(req, message.id, contact.id, mediaType, attr);
      logAuditFromRequest(req, {
        action: AuditAction.UPLOAD,
        entityType: AuditEntity.MEDIA,
        entityId: message.id,
        metadata: {
          messageId: message.id,
          contactId: contact.id,
          mimeType,
          mediaType,
          filename: file.originalname || null,
        },
      });

      const conversation = await touchConversation(contact.id);
      await markFirstHumanResponse(contact.id);
      touchLastAgent(contact.id, req.user?.id);
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(201).json(message);
    } catch (sendError) {
      const resolved = resolveOutboundError(req, sendError);
      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: mediaType,
          content,
          status: "failed",
          errorMessage: resolved.errorMessage,
          mediaUrl: local.publicPath,
          mediaMimeType: mimeType,
          caption: caption ?? null,
          ...attrData,
        },
      });
      auditMessageSent(req, message.id, contact.id, mediaType, attr, {
        failed: true,
        errorMessage: resolved.errorMessage,
        code: resolved.code,
      });
      const conversation = await touchConversation(contact.id);
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(502).json({
        error: resolved.apiError,
        code: resolved.code,
        ...(resolved.technicalMessage
          ? { technicalMessage: resolved.technicalMessage }
          : {}),
        message,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send media message";
    console.error("[messages] media error:", message);
    res.status(500).json({ error: message });
  }
}

export async function sendTemplate(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { contactId, templateId, params } = req.body as {
      contactId?: string;
      templateId?: string;
      params?: string[];
    };

    if (!contactId || !templateId) {
      res.status(400).json({ error: "contactId and templateId are required" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, contactId))) return;

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (contact.optedOut) {
      res.status(403).json({
        error: "هذا الرقم ألغى الاشتراك — لا يمكن إرسال رسائل إليه",
      });
      return;
    }

    if (contact.channel !== "whatsapp") {
      res.status(400).json({
        error: "إرسال القوالب متاح حاليًا على واتساب فقط",
      });
      return;
    }

    await stopFlow(contact.id);

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    if (template.status !== "approved") {
      res.status(400).json({
        error: `لا يمكن إرسال القالب قبل موافقة ميتا. الحالة الحالية: ${template.status}`,
      });
      return;
    }

    const attr = await attributionFromRequest(req.user);
    const attrData = attributionToPrismaData(attr);

    const conversationChannel = await prisma.conversation.findUnique({
      where: { contactId: contact.id },
      select: { channelId: true },
    });
    const whatsAppChannelId =
      conversationChannel?.channelId || contact.whatsAppChannelId || null;

    const filled =
      Array.isArray(params) && params.length
        ? params.reduce(
            (text, value, index) =>
              text.replace(`{{${index + 1}}}`, value),
            template.bodyText
          )
        : template.bodyText;

    try {
      const { waMessageId } = await sendTemplateMessage(
        contact.phone,
        template.name,
        template.language,
        Array.isArray(params) ? params : [],
        whatsAppChannelId
      );

      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: "template",
          content: filled,
          status: "sent",
          waMessageId,
          ...attrData,
        },
      });

      auditMessageSent(req, message.id, contact.id, "template", attr, {
        templateId: template.id,
        templateName: template.name,
      });

      const conversation = await touchConversation(contact.id);
      await markFirstHumanResponse(contact.id);
      touchLastAgent(contact.id, req.user?.id);
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(201).json(message);
    } catch (sendError) {
      const resolved = resolveOutboundError(req, sendError);
      const message = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "outbound",
          type: "template",
          content: filled,
          status: "failed",
          errorMessage: resolved.errorMessage,
          ...attrData,
        },
      });
      auditMessageSent(req, message.id, contact.id, "template", attr, {
        failed: true,
        errorMessage: resolved.errorMessage,
        code: resolved.code,
        templateId: template.id,
        templateName: template.name,
      });
      const conversation = await touchConversation(contact.id);
      emitAfterMessage(message, contact, conversation, { actorUser: req.user });
      res.status(502).json({
        error: resolved.apiError,
        code: resolved.code,
        ...(resolved.technicalMessage
          ? { technicalMessage: resolved.technicalMessage }
          : {}),
        message,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send template";
    console.error("[messages] template error:", message);
    res.status(500).json({ error: message });
  }
}

export async function pinMessage(req: Request, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const body = req.body as { pinned?: boolean };

    const existing = await prisma.message.findUnique({ where: { id: messageId } });
    if (!existing) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, existing.contactId))) return;

    const pinned =
      typeof body.pinned === "boolean" ? body.pinned : !existing.pinned;

    const message = await prisma.message.update({
      where: { id: messageId },
      data: { pinned },
    });

    logAuditFromRequest(req, {
      action: pinned ? AuditAction.PIN : AuditAction.UNPIN,
      entityType: AuditEntity.MESSAGE,
      entityId: messageId,
      oldValues: { pinned: existing.pinned },
      newValues: { pinned },
      metadata: { messageId, contactId: existing.contactId },
    });

    res.json(message);
  } catch (error) {
    console.error("[messages] pin error:", error);
    res.status(500).json({ error: "Failed to pin message" });
  }
}

export async function starMessage(req: Request, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const body = req.body as { starred?: boolean };

    const existing = await prisma.message.findUnique({ where: { id: messageId } });
    if (!existing) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, existing.contactId))) return;

    const starred =
      typeof body.starred === "boolean" ? body.starred : !existing.starred;

    const message = await prisma.message.update({
      where: { id: messageId },
      data: { starred },
    });

    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.MESSAGE,
      entityId: messageId,
      oldValues: { starred: existing.starred },
      newValues: { starred },
      metadata: { messageId, contactId: existing.contactId, field: "starred" },
    });

    res.json(message);
  } catch (error) {
    console.error("[messages] star error:", error);
    res.status(500).json({ error: "Failed to star message" });
  }
}

export async function softDeleteMessage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { messageId } = req.params;

    const existing = await prisma.message.findUnique({ where: { id: messageId } });
    if (!existing) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, existing.contactId))) return;

    if (existing.deletedAt) {
      res.json(existing);
      return;
    }

    const message = await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.MESSAGE,
      entityId: messageId,
      oldValues: { deletedAt: null },
      newValues: { deletedAt: message.deletedAt },
      metadata: {
        messageId,
        contactId: existing.contactId,
        originalCreatedByUserId: existing.createdByUserId,
        originalCreatedByName: existing.createdByName,
        originalSenderType: existing.senderType,
        localOnly: true,
      },
    });

    emitMessageDeleted({
      messageId: message.id,
      contactId: message.contactId,
    });

    res.json({ ...message, ...messageAttributionFields(message) });
  } catch (error) {
    console.error("[messages] delete error:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
}

const MAX_EDIT_CONTENT = 4096;

/**
 * Local inbox edit only — WhatsApp Cloud API does not support editing sent messages.
 */
export async function editMessage(req: Request, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const body = req.body as { content?: string };
    const content =
      typeof body.content === "string" ? body.content.trim() : "";

    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    if (content.length > MAX_EDIT_CONTENT) {
      res.status(400).json({
        error: `content exceeds ${MAX_EDIT_CONTENT} characters`,
      });
      return;
    }

    const existing = await prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!existing) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, existing.contactId))) return;

    if (existing.deletedAt) {
      res.status(400).json({ error: "Cannot edit a deleted message" });
      return;
    }

    if (existing.type !== "text") {
      res.status(400).json({
        error: "Only text messages can be edited in the inbox",
      });
      return;
    }

    if (existing.direction !== "outbound") {
      res.status(400).json({
        error: "Only outbound messages can be edited",
      });
      return;
    }

    if (existing.content === content) {
      res.json({ ...existing, ...messageAttributionFields(existing) });
      return;
    }

    const message = await prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
    });

    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.MESSAGE,
      entityId: messageId,
      oldValues: { content: existing.content, editedAt: existing.editedAt },
      newValues: { content: message.content, editedAt: message.editedAt },
      metadata: {
        messageId,
        contactId: existing.contactId,
        localOnly: true,
      },
    });

    const payload = { ...message, ...messageAttributionFields(message) };
    emitMessageUpdated({ message: payload });

    res.json(payload);
  } catch (error) {
    console.error("[messages] edit error:", error);
    res.status(500).json({ error: "Failed to edit message" });
  }
}
