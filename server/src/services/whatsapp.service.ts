import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import {
  resolveSendCredentials,
  type WhatsAppChannelCredentials,
} from "./whatsapp-channel.service";
export {
  WhatsAppSendError,
  isWhatsAppSendError,
  toWhatsAppSendError,
  publicSendErrorPayload,
  type WhatsAppSendErrorCode,
} from "./whatsapp-send-error";
import {
  WhatsAppSendError,
  toWhatsAppSendError,
} from "./whatsapp-send-error";

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

type MetaSendResponse = MetaErrorBody & {
  messages?: Array<{ id: string }>;
};

type MetaMediaUploadResponse = MetaErrorBody & {
  id?: string;
};

type MetaMediaUrlResponse = MetaErrorBody & {
  url?: string;
  mime_type?: string;
};

type MetaTemplateCreateResponse = MetaErrorBody & {
  id?: string;
  status?: string;
};

type MetaTemplateListResponse = MetaErrorBody & {
  data?: Array<{
    id?: string;
    name?: string;
    status?: string;
    language?: string;
  }>;
};

export type MediaType = "image" | "document" | "audio" | "video";

async function assertCredentials(
  channelId?: string | null,
  requireWaba = false
): Promise<WhatsAppChannelCredentials> {
  // Re-sync default channel from ENV/ClinicSettings when token was rotated in .env
  // but DB channel row still holds the previous token.
  const { ensureDefaultWhatsAppChannel } = await import(
    "./whatsapp-channel.service"
  );
  await ensureDefaultWhatsAppChannel();

  const creds = await resolveSendCredentials(channelId);

  if (requireWaba && (!creds.businessAccountId || creds.businessAccountId === "REPLACE_ME")) {
    throw new WhatsAppSendError({
      code: "CHANNEL_NOT_CONNECTED",
      message: "WhatsApp Business Account ID is not configured on this channel",
      agentMessage: "إعدادات القناة غير مكتملة. راجع المسؤول.",
      adminMessage:
        "WhatsApp Business Account ID غير مضبوط على هذه القناة (مطلوب للقوالب).",
    });
  }

  return creds;
}

export async function sendTextMessage(
  to: string,
  text: string,
  replyToWaMessageId?: string | null,
  channelId?: string | null
): Promise<{ waMessageId: string }> {
  const { phoneNumberId, accessToken } = await assertCredentials(channelId);
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  try {
    const { data } = await axios.post<MetaSendResponse>(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
        ...(replyToWaMessageId
          ? { context: { message_id: replyToWaMessageId } }
          : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const waMessageId = data.messages?.[0]?.id;
    if (!waMessageId) {
      throw new Error("Meta API response did not include a message id");
    }

    return { waMessageId };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to send WhatsApp message");
  }
}

export async function sendInteractiveButtons(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  channelId?: string | null
): Promise<{ waMessageId: string }> {
  const { phoneNumberId, accessToken } = await assertCredentials(channelId);
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  try {
    const { data } = await axios.post<MetaSendResponse>(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
    const waMessageId = data.messages?.[0]?.id;
    if (!waMessageId) throw new Error("No message id from interactive send");
    return { waMessageId };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to send interactive buttons");
  }
}

export async function sendInteractiveList(
  to: string,
  bodyText: string,
  buttonLabel: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  channelId?: string | null
): Promise<{ waMessageId: string }> {
  const { phoneNumberId, accessToken } = await assertCredentials(channelId);
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  try {
    const { data } = await axios.post<MetaSendResponse>(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: {
            button: buttonLabel.slice(0, 20),
            sections,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
    const waMessageId = data.messages?.[0]?.id;
    if (!waMessageId) throw new Error("No message id from list send");
    return { waMessageId };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to send list message");
  }
}

export async function uploadMedia(
  filePath: string,
  mimeType: string,
  channelId?: string | null
): Promise<{ mediaId: string }> {
  const { phoneNumberId, accessToken } = await assertCredentials(channelId);
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/media`;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: mimeType,
  });

  try {
    const { data } = await axios.post<MetaMediaUploadResponse>(url, form, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 60000,
    });

    if (!data.id) {
      throw new Error("Meta media upload did not return a media id");
    }

    return { mediaId: data.id };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to upload media to Meta");
  }
}

export async function sendMediaMessage(
  to: string,
  mediaId: string,
  type: MediaType,
  caption?: string,
  filename?: string,
  channelId?: string | null
): Promise<{ waMessageId: string }> {
  const { phoneNumberId, accessToken } = await assertCredentials(channelId);
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const mediaPayload: Record<string, string> = { id: mediaId };
  if (caption && (type === "image" || type === "document" || type === "video")) {
    mediaPayload.caption = caption;
  }
  if (filename && type === "document") {
    mediaPayload.filename = filename;
  }

  try {
    const { data } = await axios.post<MetaSendResponse>(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type,
        [type]: mediaPayload,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const waMessageId = data.messages?.[0]?.id;
    if (!waMessageId) {
      throw new Error("Meta API response did not include a message id");
    }

    return { waMessageId };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to send media message");
  }
}

export async function getMediaUrl(
  mediaId: string,
  channelId?: string | null
): Promise<string> {
  const { accessToken } = await assertCredentials(channelId);
  const url = `https://graph.facebook.com/v20.0/${mediaId}`;

  try {
    const { data } = await axios.get<MetaMediaUrlResponse>(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });

    if (!data.url) {
      throw new Error("Meta did not return a temporary media URL");
    }

    return data.url;
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to get media URL");
  }
}

export async function downloadMedia(
  mediaUrl: string,
  channelId?: string | null
): Promise<Buffer> {
  const { accessToken } = await assertCredentials(channelId);

  try {
    const { data } = await axios.get<ArrayBuffer>(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "arraybuffer",
      timeout: 60000,
    });
    return Buffer.from(data);
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to download media");
  }
}

function extractTemplateVariables(bodyText: string): string[] {
  const matches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
  return [...new Set(matches)];
}

export async function createTemplate(
  name: string,
  category: string,
  language: string,
  bodyText: string,
  channelId?: string | null
): Promise<{ metaTemplateId: string; status: string }> {
  const { accessToken, businessAccountId: wabaId } = await assertCredentials(
    channelId,
    true
  );
  const url = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;

  const variables = extractTemplateVariables(bodyText);
  const bodyComponent: Record<string, unknown> = {
    type: "BODY",
    text: bodyText,
  };

  if (variables.length > 0) {
    bodyComponent.example = {
      body_text: [variables.map((_, i) => `example${i + 1}`)],
    };
  }

  try {
    const { data } = await axios.post<MetaTemplateCreateResponse>(
      url,
      {
        name,
        language,
        category,
        components: [bodyComponent],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    if (!data.id) {
      throw new Error("Meta did not return a template id");
    }

    return {
      metaTemplateId: data.id,
      status: (data.status || "PENDING").toLowerCase(),
    };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to create template on Meta");
  }
}

export async function getTemplateStatusFromMeta(
  templateName: string,
  channelId?: string | null
): Promise<{ status: string; metaTemplateId?: string }> {
  const { accessToken, businessAccountId: wabaId } = await assertCredentials(
    channelId,
    true
  );
  const url = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;

  try {
    const { data } = await axios.get<MetaTemplateListResponse>(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { name: templateName },
      timeout: 15000,
    });

    const match = data.data?.[0];
    if (!match?.status) {
      throw new Error(`Template "${templateName}" not found on Meta`);
    }

    return {
      status: match.status.toLowerCase(),
      metaTemplateId: match.id,
    };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to sync template status from Meta");
  }
}

export async function sendTemplateMessage(
  to: string,
  templateName: string,
  language: string,
  params: string[] = [],
  channelId?: string | null
): Promise<{ waMessageId: string }> {
  const { phoneNumberId, accessToken } = await assertCredentials(channelId);
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const components =
    params.length > 0
      ? [
          {
            type: "body",
            parameters: params.map((text) => ({ type: "text", text })),
          },
        ]
      : [];

  try {
    const { data } = await axios.post<MetaSendResponse>(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components.length ? { components } : {}),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const waMessageId = data.messages?.[0]?.id;
    if (!waMessageId) {
      throw new Error("Meta API response did not include a message id");
    }

    return { waMessageId };
  } catch (error) {
    throw toWhatsAppSendError(error, "Failed to send template message");
  }
}

export function mimeToMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}
