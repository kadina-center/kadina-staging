import axios from "axios";
import { env } from "../config/env";
import type {
  ChannelAdapter,
  ParseWebhookResult,
  ParsedInboundMessage,
} from "../channels/types";

type MetaErrorBody = {
  error?: { message?: string };
};

type MetaSendResponse = MetaErrorBody & {
  message_id?: string;
};

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    attachments?: Array<{
      type?: string;
      payload?: { url?: string };
    }>;
  };
  delivery?: { mids?: string[] };
  read?: { watermark?: number };
};

function assertCredentials(): { accessToken: string; pageId: string } {
  const accessToken = env.INSTAGRAM_ACCESS_TOKEN;
  const pageId = env.INSTAGRAM_PAGE_ID;
  if (
    !accessToken ||
    accessToken === "REPLACE_ME" ||
    !pageId ||
    pageId === "REPLACE_ME"
  ) {
    throw new Error(
      "Instagram credentials are not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_PAGE_ID in .env"
    );
  }
  return { accessToken, pageId };
}

function metaErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const metaError = error.response?.data as MetaErrorBody | undefined;
    return metaError?.error?.message || error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export async function sendInstagramText(
  to: string,
  text: string
): Promise<{ platformMessageId: string }> {
  const { accessToken, pageId } = assertCredentials();
  const url = `https://graph.facebook.com/v20.0/${pageId}/messages`;

  try {
    const { data } = await axios.post<MetaSendResponse>(
      url,
      {
        recipient: { id: to },
        message: { text },
        messaging_type: "RESPONSE",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        params: { access_token: accessToken },
        timeout: 15000,
      }
    );

    const platformMessageId = data.message_id;
    if (!platformMessageId) {
      throw new Error("Instagram API response did not include a message id");
    }
    return { platformMessageId };
  } catch (error) {
    throw new Error(metaErrorMessage(error, "Failed to send Instagram message"));
  }
}

function parseMessagingEvents(
  events: MessagingEvent[] | undefined
): ParseWebhookResult {
  const messages: ParsedInboundMessage[] = [];
  const statuses: ParseWebhookResult["statuses"] = [];

  for (const event of events ?? []) {
    const senderId = event.sender?.id;
    if (event.message && senderId) {
      const text = event.message.text?.trim() || "";
      const attachment = event.message.attachments?.[0];
      const type = attachment?.type || (text ? "text" : "unknown");
      const content =
        text ||
        (attachment?.payload?.url
          ? `[${type}] ${attachment.payload.url}`
          : `[${type}]`);

      messages.push({
        channel: "instagram",
        channelUserId: senderId,
        phone: `ig_${senderId}`,
        profileName: null,
        platformMessageId: event.message.mid ?? null,
        type,
        content,
      });
    }

    if (event.delivery?.mids?.length) {
      for (const mid of event.delivery.mids) {
        statuses.push({
          channel: "instagram",
          platformMessageId: mid,
          status: "delivered",
        });
      }
    }

    if (event.read && event.message?.mid) {
      statuses.push({
        channel: "instagram",
        platformMessageId: event.message.mid,
        status: "read",
      });
    }
  }

  return { messages, statuses };
}

export function parseInstagramWebhook(payload: unknown): ParseWebhookResult {
  const body = payload as {
    object?: string;
    entry?: Array<{
      messaging?: MessagingEvent[];
      standbys?: MessagingEvent[];
    }>;
  };

  const messages: ParsedInboundMessage[] = [];
  const statuses: ParseWebhookResult["statuses"] = [];

  for (const entry of body.entry ?? []) {
    const parsed = parseMessagingEvents(entry.messaging ?? entry.standbys);
    messages.push(...parsed.messages);
    statuses.push(...parsed.statuses);
  }

  return { messages, statuses };
}

export const instagramAdapter: ChannelAdapter = {
  channel: "instagram",
  async sendMessage(to, content) {
    return sendInstagramText(to, content);
  },
  parseIncomingWebhook: parseInstagramWebhook,
};
