/**
 * Backward-compatible WhatsApp webhook entrypoints.
 * Implementation lives in channel-webhook.controller (multi-channel).
 */
export {
  verifyChannelWebhook as verifyWebhook,
  handleChannelWebhook as handleWebhook,
} from "./channel-webhook.controller";
