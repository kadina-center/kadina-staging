/**
 * Unified messaging channel adapter.
 * WhatsApp / Instagram / Messenger each implement this interface.
 */

export type ChannelName = "whatsapp" | "instagram" | "messenger";

export type ParsedInboundMessage = {
  channel: ChannelName;
  /** Platform user id (WA phone, IG/Messenger PSID) */
  channelUserId: string;
  /** Synthetic or real phone/handle stored on Contact.phone */
  phone: string;
  profileName: string | null;
  platformMessageId: string | null;
  type: string;
  content: string;
  caption?: string | null;
  /** Raw media id from Meta (WhatsApp); adapters may leave unset */
  mediaId?: string | null;
  mediaMimeType?: string | null;
  mediaFilename?: string | null;
  /** JSON extras (location, contacts, interactive, reaction, reply context) */
  metaPayload?: string | null;
  /** Meta metadata.phone_number_id — required to route WhatsApp multi-channel */
  phoneNumberId?: string | null;
};

export type ParsedInboundStatus = {
  channel: ChannelName;
  platformMessageId: string;
  status: string;
  phoneNumberId?: string | null;
};

export type ParseWebhookResult = {
  messages: ParsedInboundMessage[];
  statuses: ParsedInboundStatus[];
};

export interface ChannelAdapter {
  readonly channel: ChannelName;
  sendMessage(to: string, content: string): Promise<{ platformMessageId: string }>;
  parseIncomingWebhook(payload: unknown): ParseWebhookResult;
}
