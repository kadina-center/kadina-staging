import type { Request, Response } from "express";
import { detectWebhookChannel, getChannelAdapter } from "../channels";
import type { ParsedInboundMessage } from "../channels/types";
import { prisma } from "../lib/prisma";
import { updateRecipientStatusByWaId } from "../services/broadcast.service";
import {
  getOrCreateClinicSettings,
  getWhatsAppConfig,
  isWithinBusinessHours,
  parseBusinessHours,
} from "../services/clinic-settings.service";
import { touchConversation } from "../services/conversation.service";
import { maybeStartFlowForInbound } from "../services/flow-engine.service";
import { saveMediaBuffer } from "../services/media-storage.service";
import {
  emitConversationUpdated,
  emitMessageStatus,
  emitNewMessage,
} from "../services/socket.service";
import { dispatchEvent } from "../services/webhook-dispatcher.service";
import {
  downloadMedia,
  getMediaUrl,
  sendTextMessage,
} from "../services/whatsapp.service";
import { logSystemError } from "../services/error-log.service";
import {
  TimelineEventType,
  actorCustomer,
  actorSystem,
  logTimeline,
} from "../services/timeline.service";
import {
  UnknownPhoneNumberIdError,
  resolveChannelFromPhoneNumberId,
  touchChannelMessage,
  touchChannelWebhook,
} from "../services/whatsapp-channel.service";
import { logAudit } from "../services/audit.service";

/** Opt-out keywords (Meta policy) — extend as needed */
const OPT_OUT_KEYWORDS = new Set([
  "stop",
  "توقف",
  "الغاء",
  "إلغاء",
  "الغاء الاشتراك",
  "إلغاء الاشتراك",
  "unsubscribe",
  "optout",
  "opt-out",
  "الغاءالاشتراك",
  "إلغاءالاشتراك",
]);

const MEDIA_TYPES = new Set(["image", "document", "audio", "video"]);
const AWAY_COOLDOWN_MS = 30 * 60 * 1000;

function isOptOutText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return OPT_OUT_KEYWORDS.has(normalized);
}

function extractReplyToWaId(metaPayload: string | null | undefined): string | null {
  if (!metaPayload) return null;
  try {
    const meta = JSON.parse(metaPayload) as { replyToWaMessageId?: string };
    return meta.replyToWaMessageId || null;
  } catch {
    return null;
  }
}

async function resolveReplyToMessageId(
  replyToWaMessageId: string | null
): Promise<string | null> {
  if (!replyToWaMessageId) return null;
  const found = await prisma.message.findFirst({
    where: { waMessageId: replyToWaMessageId },
    select: { id: true },
  });
  return found?.id ?? null;
}

async function bumpUnreadAndUnarchive(conversationId: string) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      unreadCount: { increment: 1 },
      archived: false,
    },
    include: {
      contact: true,
      assignedTo: true,
      tags: true,
    },
  });
}

async function maybeSendWelcome(
  contactPhone: string,
  conversationJustCreated: boolean,
  channel: string,
  whatsAppChannelId: string,
  contactId: string
): Promise<void> {
  if (!conversationJustCreated || channel !== "whatsapp") return;
  const settings = await getOrCreateClinicSettings();
  if (!settings.welcomeEnabled || !settings.welcomeMessage?.trim()) return;

  try {
    const { waMessageId } = await sendTextMessage(
      contactPhone,
      settings.welcomeMessage.trim(),
      null,
      whatsAppChannelId
    );
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });
    if (!contact) return;

    const {
      attributionSystem,
      attributionToPrismaData,
      messageAttributionFields,
    } = await import("../services/message-attribution.service");
    const { logAudit } = await import("../services/audit.service");
    const attr = attributionSystem("System");
    const message = await prisma.message.create({
      data: {
        contactId: contact.id,
        direction: "outbound",
        type: "text",
        content: settings.welcomeMessage.trim(),
        status: "sent",
        waMessageId,
        ...attributionToPrismaData(attr),
      },
    });
    void logAudit({
      actorId: null,
      action: "message.sent",
      entityType: "Message",
      entityId: message.id,
      meta: {
        contactId: contact.id,
        type: "text",
        kind: "welcome",
        channelId: whatsAppChannelId,
        senderType: attr.senderType,
        createdByName: attr.createdByName,
        automated: true,
      },
    });
    const conversation = await touchConversation(contact.id, whatsAppChannelId);
    void touchChannelMessage(whatsAppChannelId);
    const attrFields = messageAttributionFields(message);
    emitNewMessage({
      message: { ...message, ...attrFields },
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
    void logTimeline({
      contactId: contact.id,
      conversationId: conversation.id,
      eventType: TimelineEventType.WELCOME_SENT,
      title: "رسالة ترحيب",
      description: settings.welcomeMessage.trim().slice(0, 200),
      actor: actorSystem(),
      metadata: { messageId: message.id, kind: "welcome" },
    });
  } catch (error) {
    console.error("[channel-webhook] welcome message failed:", error);
  }
}

async function maybeSendAway(
  contactId: string,
  contactPhone: string,
  channel: string,
  whatsAppChannelId: string
): Promise<void> {
  if (channel !== "whatsapp") return;

  const settings = await getOrCreateClinicSettings();
  if (!settings.awayEnabled || !settings.awayMessage?.trim()) return;

  const hours = parseBusinessHours(settings.businessHoursJson);
  if (isWithinBusinessHours(hours, new Date(), settings.timezone || "Asia/Aden"))
    return;

  const since = new Date(Date.now() - AWAY_COOLDOWN_MS);
  const recentOutbound = await prisma.message.findFirst({
    where: {
      contactId,
      direction: "outbound",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });

  // Skip if we already sent something (including away) in the last 30 minutes
  if (recentOutbound) return;

  try {
    const awayText = settings.awayMessage.trim();
    const { waMessageId } = await sendTextMessage(
      contactPhone,
      awayText,
      null,
      whatsAppChannelId
    );
    const {
      attributionSystem,
      attributionToPrismaData,
      messageAttributionFields,
    } = await import("../services/message-attribution.service");
    const { logAudit } = await import("../services/audit.service");
    const attr = attributionSystem("System");
    const message = await prisma.message.create({
      data: {
        contactId,
        direction: "outbound",
        type: "text",
        content: awayText,
        status: "sent",
        waMessageId,
        ...attributionToPrismaData(attr),
      },
    });
    void logAudit({
      actorId: null,
      action: "message.sent",
      entityType: "Message",
      entityId: message.id,
      meta: {
        contactId,
        type: "text",
        kind: "away",
        channelId: whatsAppChannelId,
        senderType: attr.senderType,
        createdByName: attr.createdByName,
        automated: true,
      },
    });
    const conversation = await touchConversation(contactId, whatsAppChannelId);
    void touchChannelMessage(whatsAppChannelId);
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (contact) {
      emitNewMessage({
        message: { ...message, ...messageAttributionFields(message) },
        contact: {
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          lastMessageAt: conversation.lastMessageAt,
        },
      });
      void logTimeline({
        contactId,
        conversationId: conversation.id,
        eventType: TimelineEventType.AWAY_SENT,
        title: "رسالة خارج أوقات العمل",
        description: awayText.slice(0, 200),
        actor: actorSystem(),
        metadata: { messageId: message.id, kind: "away" },
      });
    }
  } catch (error) {
    console.error("[channel-webhook] away message failed:", error);
  }
}

export async function verifyChannelWebhook(
  req: Request,
  res: Response
): Promise<void> {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const cfg = await getWhatsAppConfig();

  if (mode === "subscribe" && token === cfg.verifyToken) {
    console.log("[channel-webhook] Verification successful");
    res.status(200).send(challenge);
    return;
  }

  console.warn("[channel-webhook] Verification failed");
  res.sendStatus(403);
}

export async function handleChannelWebhook(
  req: Request,
  res: Response
): Promise<void> {
  // Respond immediately — Meta expects a fast 200
  res.sendStatus(200);

  try {
    const objectType = (req.body as { object?: string } | undefined)?.object;
    console.log(
      `[channel-webhook] POST object=${objectType ?? "unknown"}`
    );

    const channel = detectWebhookChannel(req.body);
    if (!channel) {
      console.warn(
        "[channel-webhook] Could not detect channel; payload ignored"
      );
      return;
    }

    const adapter = getChannelAdapter(channel);
    const parsed = adapter.parseIncomingWebhook(req.body);
    console.log(
      `[channel-webhook] channel=${channel} messages=${parsed.messages.length} statuses=${parsed.statuses.length}`,
      parsed.messages.map((m) => ({
        from: m.phone,
        type: m.type,
        content: m.content.slice(0, 80),
      }))
    );

    if (parsed.statuses.length) {
      await processStatuses(parsed.statuses);
    }

    if (parsed.messages.length) {
      await processInboundMessages(parsed.messages);
      console.log(
        `[channel-webhook] persisted ${parsed.messages.length} inbound message(s)`
      );
    } else {
      console.log("[channel-webhook] no inbound messages in payload (status-only or empty)");
    }
  } catch (error) {
    console.error("[channel-webhook] Error processing payload:", error);
    void logSystemError({
      source: "channel-webhook",
      message: error instanceof Error ? error.message : "Webhook processing failed",
      stack: error instanceof Error ? error.stack : undefined,
      meta: { object: (req.body as { object?: string } | undefined)?.object },
    });
  }
}

async function storeInboundMedia(
  mediaId: string,
  mimeType: string,
  filename: string | null | undefined,
  whatsAppChannelId: string
): Promise<{ publicPath: string; mimeType: string }> {
  const temporaryUrl = await getMediaUrl(mediaId, whatsAppChannelId);
  const buffer = await downloadMedia(temporaryUrl, whatsAppChannelId);
  const saved = await saveMediaBuffer(buffer, mimeType, filename ?? undefined);
  return { publicPath: saved.publicPath, mimeType };
}

async function upsertContactFromInbound(
  msg: ParsedInboundMessage,
  whatsAppChannelId: string | null
) {
  const channelScope =
    msg.channel === "whatsapp" && whatsAppChannelId
      ? whatsAppChannelId
      : "_";

  return prisma.contact.upsert({
    where: {
      channel_phone_channelScope: {
        channel: msg.channel,
        phone: msg.phone,
        channelScope,
      },
    },
    create: {
      phone: msg.phone,
      name: msg.profileName,
      channel: msg.channel,
      channelUserId: msg.channelUserId,
      whatsAppChannelId:
        msg.channel === "whatsapp" ? whatsAppChannelId : null,
      channelScope,
      lastMessageAt: new Date(),
    },
    update: {
      ...(msg.profileName ? { name: msg.profileName } : {}),
      channelUserId: msg.channelUserId,
      lastMessageAt: new Date(),
      ...(msg.channel === "whatsapp" && whatsAppChannelId
        ? { whatsAppChannelId, channelScope }
        : {}),
    },
  });
}

async function processInboundMessages(
  messages: ParsedInboundMessage[]
): Promise<void> {
  for (const msg of messages) {
    // Idempotency: Meta may redeliver the same webhook event on timeout/retry.
    // Skip if we've already stored this platform message id.
    if (msg.platformMessageId) {
      const existing = await prisma.message.findUnique({
        where: { waMessageId: msg.platformMessageId },
        select: { id: true },
      });
      if (existing) {
        console.log(
          `[channel-webhook] duplicate inbound message waMessageId=${msg.platformMessageId} — skipping`
        );
        continue;
      }
    }

    let whatsAppChannelId: string | null = null;
    if (msg.channel === "whatsapp") {
      try {
        const waChannel = await resolveChannelFromPhoneNumberId(
          msg.phoneNumberId
        );
        whatsAppChannelId = waChannel.id;
        void touchChannelWebhook(waChannel.id);
      } catch (error) {
        if (error instanceof UnknownPhoneNumberIdError) {
          console.warn(
            `[channel-webhook] unknown phone_number_id=${error.phoneNumberId} — dropping inbound`
          );
          void logAudit({
            actorId: null,
            action: "UPDATE",
            entityType: "SETTINGS",
            status: "FAILED",
            meta: {
              kind: "whatsapp_channel.unknown_inbound",
              phoneNumberId: error.phoneNumberId,
              from: msg.phone,
            },
          });
          void logSystemError({
            source: "channel-webhook",
            message: `Unknown WhatsApp phone_number_id: ${error.phoneNumberId}`,
            meta: { phoneNumberId: error.phoneNumberId, from: msg.phone },
          });
          continue;
        }
        throw error;
      }
    }

    let content = msg.content;
    let caption = msg.caption ?? null;
    let mediaUrl: string | null = null;
    let mediaMimeType: string | null = msg.mediaMimeType ?? null;
    const metaPayload = msg.metaPayload ?? null;
    const replyToWaMessageId = extractReplyToWaId(metaPayload);
    const replyToMessageId = await resolveReplyToMessageId(replyToWaMessageId);

    if (msg.channel === "whatsapp" && msg.type === "text" && isOptOutText(content)) {
      const contact = await upsertContactFromInbound(msg, whatsAppChannelId);
      await prisma.contact.update({
        where: { id: contact.id },
        data: { optedOut: true },
      });

      await touchConversation(contact.id, whatsAppChannelId);
      await bumpUnreadAndUnarchive(
        (
          await prisma.conversation.findUniqueOrThrow({
            where: { contactId: contact.id },
          })
        ).id
      );

      const saved = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "inbound",
          type: "text",
          content,
          status: "delivered",
          waMessageId: msg.platformMessageId,
          metaPayload,
          replyToWaMessageId,
          replyToMessageId,
        },
      });

      emitNewMessage({
        message: saved,
        contact: {
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          lastMessageAt: contact.lastMessageAt,
        },
      });

      void dispatchEvent("message.received", {
        message: saved,
        contact: {
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          channel: contact.channel,
        },
        channelId: whatsAppChannelId,
      });

      const optOutConversation = await prisma.conversation.findUnique({
        where: { contactId: contact.id },
        select: { id: true },
      });
      void logTimeline({
        contactId: contact.id,
        conversationId: optOutConversation?.id,
        eventType: TimelineEventType.MESSAGE_RECEIVED,
        title: "رسالة واردة",
        description: content.slice(0, 200),
        actor: actorCustomer(contact.name),
        metadata: {
          messageId: saved.id,
          type: saved.type,
          channelId: whatsAppChannelId,
        },
      });

      try {
        if (whatsAppChannelId) {
          await sendTextMessage(
            contact.phone,
            "تم إلغاء اشتراكك بنجاح. لن تصلك رسائل ترويجية بعد الآن. أرسل START لإعادة الاشتراك.",
            null,
            whatsAppChannelId
          );
          void touchChannelMessage(whatsAppChannelId);
        }
      } catch (error) {
        console.error("[channel-webhook] Opt-out confirmation failed:", error);
      }

      continue;
    }

    if (
      msg.channel === "whatsapp" &&
      MEDIA_TYPES.has(msg.type) &&
      msg.mediaId &&
      whatsAppChannelId
    ) {
      try {
        const stored = await storeInboundMedia(
          msg.mediaId,
          msg.mediaMimeType || "application/octet-stream",
          msg.mediaFilename,
          whatsAppChannelId
        );
        mediaUrl = stored.publicPath;
        mediaMimeType = stored.mimeType;
        caption = msg.caption ?? null;
        content = caption || msg.mediaFilename || `[${msg.type}]`;
      } catch (error) {
        console.error("[channel-webhook] Failed to download inbound media:", error);
        content = msg.caption || `[${msg.type} — فشل تنزيل الملف]`;
      }
    }

    const channelScope =
      msg.channel === "whatsapp" && whatsAppChannelId
        ? whatsAppChannelId
        : "_";
    const priorConversation = await prisma.conversation.findFirst({
      where: {
        contact: {
          channel: msg.channel,
          phone: msg.phone,
          channelScope,
        },
      },
    });
    const conversationJustCreated = !priorConversation;

    const contact = await upsertContactFromInbound(msg, whatsAppChannelId);
    await touchConversation(contact.id, whatsAppChannelId);

    const conversation = await bumpUnreadAndUnarchive(
      (
        await prisma.conversation.findUniqueOrThrow({
          where: { contactId: contact.id },
        })
      ).id
    );

    let saved;
    try {
      saved = await prisma.message.create({
        data: {
          contactId: contact.id,
          direction: "inbound",
          type: msg.type,
          content,
          status: "delivered",
          waMessageId: msg.platformMessageId,
          mediaUrl,
          mediaMimeType,
          caption,
          metaPayload,
          replyToWaMessageId,
          replyToMessageId,
        },
      });
    } catch (createError) {
      // Race with Meta retry: unique waMessageId already inserted
      if (
        createError &&
        typeof createError === "object" &&
        "code" in createError &&
        (createError as { code?: string }).code === "P2002"
      ) {
        console.log(
          `[channel-webhook] duplicate race waMessageId=${msg.platformMessageId} — skipping`
        );
        continue;
      }
      throw createError;
    }

    if (whatsAppChannelId) {
      void touchChannelMessage(whatsAppChannelId);
    }

    emitNewMessage({
      message: saved,
      contact: {
        id: contact.id,
        phone: contact.phone,
        name: contact.name,
        lastMessageAt: contact.lastMessageAt,
      },
      channelId: whatsAppChannelId,
    });

    emitConversationUpdated({
      id: conversation.id,
      contactId: conversation.contactId,
      channelId: conversation.channelId,
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
          id: saved.id,
          content: saved.content,
          direction: saved.direction,
          createdAt: saved.createdAt,
          status: saved.status,
        },
      },
      assignedTo: conversation.assignedTo,
      tags: conversation.tags,
    });

    void dispatchEvent("message.received", {
      message: saved,
      contact: {
        id: contact.id,
        phone: contact.phone,
        name: contact.name,
        channel: contact.channel,
        channelUserId: contact.channelUserId,
      },
      conversationId: conversation.id,
      channelId: whatsAppChannelId,
    });

    void logTimeline({
      contactId: contact.id,
      conversationId: conversation.id,
      eventType: TimelineEventType.MESSAGE_RECEIVED,
      title: "رسالة واردة",
      description: (saved.content || "").slice(0, 200),
      actor: actorCustomer(contact.name),
      metadata: {
        messageId: saved.id,
        type: saved.type,
        channelId: whatsAppChannelId,
      },
    });

    void logAudit({
      actorId: null,
      action: "SEND",
      entityType: "MESSAGE",
      entityId: saved.id,
      status: "SUCCESS",
      meta: {
        kind: "message.received",
        contactId: contact.id,
        channelId: whatsAppChannelId,
        type: saved.type,
      },
    });

    // Do not block inbound persistence on Meta outbound (welcome/away/flows).
    // A failed/slow WhatsApp token must never delay saving the customer message.
    if (whatsAppChannelId) {
      void maybeSendWelcome(
        contact.phone,
        conversationJustCreated,
        msg.channel,
        whatsAppChannelId,
        contact.id
      ).catch((error) =>
        console.error("[channel-webhook] welcome async failed:", error)
      );
      void maybeSendAway(
        contact.id,
        contact.phone,
        msg.channel,
        whatsAppChannelId
      ).catch((error) =>
        console.error("[channel-webhook] away async failed:", error)
      );
    }
    void (async () => {
      try {
        const freshContact = await prisma.contact.findUnique({
          where: { id: contact.id },
        });
        if (freshContact) {
          await maybeStartFlowForInbound(
            freshContact,
            content,
            conversation.assignedToId
          );
        }
      } catch (error) {
        console.error("[channel-webhook] flow engine error:", error);
      }
    })();
  }
}

async function processStatuses(
  statuses: Array<{ platformMessageId: string; status: string }>
): Promise<void> {
  for (const statusItem of statuses) {
    const waMessageId = statusItem.platformMessageId;
    const status = statusItem.status;
    if (!waMessageId || !status) continue;

    const updated = await prisma.message.updateMany({
      where: { waMessageId },
      data: { status },
    });

    if (updated.count > 0) {
      const message = await prisma.message.findFirst({
        where: { waMessageId },
        include: {
          contact: { select: { id: true, name: true } },
        },
      });
      emitMessageStatus({
        waMessageId,
        status,
        contactId: message?.contactId,
      });

      if (message?.contactId) {
        const conversation = await prisma.conversation.findUnique({
          where: { contactId: message.contactId },
          select: { id: true },
        });

        if (status === "read") {
          void logTimeline({
            contactId: message.contactId,
            conversationId: conversation?.id,
            eventType: TimelineEventType.MESSAGE_READ,
            title: "تمت قراءة الرسالة",
            description: (message.content || "").slice(0, 200),
            actor: actorCustomer(message.contact.name),
            metadata: {
              messageId: message.id,
              waMessageId,
              direction: message.direction,
            },
          });
        } else if (
          status === "failed" &&
          message.direction === "outbound"
        ) {
          void logTimeline({
            contactId: message.contactId,
            conversationId: conversation?.id,
            eventType: TimelineEventType.MESSAGE_FAILED,
            title: "فشل إرسال رسالة",
            description: (message.content || "").slice(0, 200),
            actor: actorSystem(),
            metadata: {
              messageId: message.id,
              waMessageId,
              direction: message.direction,
            },
          });
        }
      }
    }

    await updateRecipientStatusByWaId(waMessageId, status).catch((error) => {
      console.error("[channel-webhook] campaign recipient status error:", error);
    });
  }
}
