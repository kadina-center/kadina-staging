/** Central limit for clinic WhatsApp numbers (Phase A). Expand later without schema rewrite. */
export const MAX_WHATSAPP_CHANNELS = 5;

export const MAX_WHATSAPP_CHANNELS_MESSAGE =
  "Maximum of 5 WhatsApp channels is allowed.";

export const DEFAULT_WHATSAPP_CHANNEL_ID = "wa_channel_default_kadina";

export const WhatsAppChannelStatus = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  ERROR: "ERROR",
  PENDING: "PENDING",
} as const;

export type WhatsAppChannelStatusValue =
  (typeof WhatsAppChannelStatus)[keyof typeof WhatsAppChannelStatus];
