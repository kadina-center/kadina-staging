import type {
  ChannelAdapter,
  ParseWebhookResult,
  ParsedInboundMessage,
} from "./types";
import { sendTextMessage } from "../services/whatsapp.service";

type MediaPayload = {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
};

type WhatsAppInboundMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: MediaPayload;
  document?: MediaPayload;
  audio?: MediaPayload;
  video?: MediaPayload;
  sticker?: MediaPayload;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{
    name?: { formatted_name?: string };
    phones?: Array<{ phone?: string }>;
  }>;
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  button?: { payload?: string; text?: string };
  reaction?: { message_id?: string; emoji?: string };
  context?: { id?: string; from?: string; forwarded?: boolean };
};

type WhatsAppContact = {
  profile?: { name?: string };
  wa_id?: string;
};

type WhatsAppStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
};

type WebhookChangeValue = {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  messages?: WhatsAppInboundMessage[];
  contacts?: WhatsAppContact[];
  statuses?: WhatsAppStatus[];
};

function getMediaPayload(
  msg: WhatsAppInboundMessage
): MediaPayload | undefined {
  const type = msg.type;
  if (type === "image") return msg.image;
  if (type === "document") return msg.document;
  if (type === "audio") return msg.audio;
  if (type === "video") return msg.video;
  if (type === "sticker") return msg.sticker;
  return undefined;
}

export function parseWhatsAppWebhook(payload: unknown): ParseWebhookResult {
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: WebhookChangeValue;
      }>;
    }>;
  };

  const messages: ParsedInboundMessage[] = [];
  const statuses: ParseWebhookResult["statuses"] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      const profileName = value.contacts?.[0]?.profile?.name ?? null;

      for (const statusItem of value.statuses ?? []) {
        if (!statusItem.id || !statusItem.status) continue;
        statuses.push({
          channel: "whatsapp",
          platformMessageId: statusItem.id,
          status: statusItem.status,
          phoneNumberId,
        });
      }

      for (const msg of value.messages ?? []) {
        const from = msg.from;
        if (!from) continue;

        const type = msg.type ?? "text";
        let content = "";
        let caption: string | null = null;
        let mediaId: string | null = null;
        let mediaMimeType: string | null = null;
        let mediaFilename: string | null = null;
        const meta: Record<string, unknown> = {};

        if (msg.context?.id) {
          meta.replyToWaMessageId = msg.context.id;
          meta.forwarded = !!msg.context.forwarded;
        }

        if (type === "text") {
          content = msg.text?.body ?? "";
          if (!content) continue;
        } else if (
          type === "image" ||
          type === "document" ||
          type === "audio" ||
          type === "video" ||
          type === "sticker"
        ) {
          const media = getMediaPayload(msg);
          mediaId = media?.id ?? null;
          caption = media?.caption ?? null;
          mediaMimeType = media?.mime_type ?? null;
          mediaFilename = media?.filename ?? null;
          content = caption || mediaFilename || `[${type}]`;
        } else if (type === "location" && msg.location) {
          content = msg.location.name
            ? `📍 ${msg.location.name}`
            : `📍 ${msg.location.latitude},${msg.location.longitude}`;
          meta.location = msg.location;
        } else if (type === "contacts" && msg.contacts?.length) {
          const c = msg.contacts[0];
          content = `👤 ${c.name?.formatted_name || "جهة اتصال"} ${c.phones?.[0]?.phone || ""}`.trim();
          meta.contacts = msg.contacts;
        } else if (type === "interactive") {
          const reply =
            msg.interactive?.button_reply || msg.interactive?.list_reply;
          content = reply?.title || "[interactive]";
          meta.interactive = msg.interactive;
        } else if (type === "button") {
          content = msg.button?.text || msg.button?.payload || "[button]";
          meta.button = msg.button;
        } else if (type === "reaction") {
          content = msg.reaction?.emoji || "👍";
          meta.reaction = msg.reaction;
        } else {
          content = `[${type} message]`;
        }

        messages.push({
          channel: "whatsapp",
          channelUserId: from,
          phone: from,
          profileName,
          platformMessageId: msg.id ?? null,
          type,
          content,
          caption,
          mediaId,
          mediaMimeType,
          mediaFilename,
          phoneNumberId,
          metaPayload: Object.keys(meta).length
            ? JSON.stringify(meta)
            : null,
        });
      }
    }
  }

  return { messages, statuses };
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  async sendMessage(to, content) {
    const { waMessageId } = await sendTextMessage(to, content);
    return { platformMessageId: waMessageId };
  },
  parseIncomingWebhook: parseWhatsAppWebhook,
};
