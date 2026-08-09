import type { ChannelAdapter, ChannelName } from "./types";
import { whatsappAdapter } from "./whatsapp.adapter";
import { instagramAdapter } from "../services/instagram.service";
import { messengerAdapter } from "../services/messenger.service";

const adapters: Record<ChannelName, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  instagram: instagramAdapter,
  messenger: messengerAdapter,
};

export function getChannelAdapter(channel: string): ChannelAdapter {
  const key = (channel || "whatsapp") as ChannelName;
  return adapters[key] ?? adapters.whatsapp;
}

export function detectWebhookChannel(payload: unknown): ChannelName | null {
  const body = payload as {
    object?: string;
    entry?: Array<{
      messaging?: unknown[];
      changes?: unknown[];
    }>;
  };

  const entry = body.entry?.[0];
  if (!entry) return null;

  // Messenger / Instagram Messaging use entry[].messaging
  if (entry.messaging?.length) {
    if (body.object === "instagram") return "instagram";
    if (body.object === "page") return "messenger";
    // Fallback: treat as messenger-style when messaging array present
    return body.object === "instagram" ? "instagram" : "messenger";
  }

  // WhatsApp Cloud API uses entry[].changes
  if (entry.changes?.length || body.object === "whatsapp_business_account") {
    return "whatsapp";
  }

  return null;
}

export type { ChannelAdapter, ChannelName } from "./types";
export { whatsappAdapter } from "./whatsapp.adapter";
