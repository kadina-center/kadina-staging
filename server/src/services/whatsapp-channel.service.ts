import axios from "axios";
import dotenv from "dotenv";
import type { WhatsAppChannel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getWhatsAppConfig } from "./clinic-settings.service";
import {
  DEFAULT_WHATSAPP_CHANNEL_ID,
  MAX_WHATSAPP_CHANNELS,
  MAX_WHATSAPP_CHANNELS_MESSAGE,
  WhatsAppChannelStatus,
} from "../constants/whatsapp-channels";

export class ChannelLimitError extends Error {
  readonly statusCode = 409;
  constructor(message = MAX_WHATSAPP_CHANNELS_MESSAGE) {
    super(message);
    this.name = "ChannelLimitError";
  }
}

export class ChannelNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = "WhatsApp channel not found") {
    super(message);
    this.name = "ChannelNotFoundError";
  }
}

export class UnknownPhoneNumberIdError extends Error {
  readonly statusCode = 400;
  constructor(public readonly phoneNumberId: string) {
    super(`Unknown WhatsApp phone_number_id: ${phoneNumberId}`);
    this.name = "UnknownPhoneNumberIdError";
  }
}

/** Public DTO — never includes accessToken */
export type WhatsAppChannelPublic = {
  id: string;
  name: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string | null;
  status: string;
  isActive: boolean;
  assignedUserId: string | null;
  lastWebhookAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  conversationCount?: number;
};

export type WhatsAppChannelCredentials = {
  channelId: string;
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string | null;
  isActive: boolean;
  status: string;
};

const SEED_PHONE = "PENDING_SEED_PHONE_NUMBER_ID";
const SEED_TOKEN = "PENDING_SEED_ACCESS_TOKEN";

function isPlaceholder(value: string | null | undefined): boolean {
  return (
    !value ||
    value === "REPLACE_ME" ||
    value.startsWith("REPLACE_") ||
    value === SEED_PHONE ||
    value === SEED_TOKEN
  );
}

export function toPublicChannel(
  channel: WhatsAppChannel & { _count?: { conversations?: number } }
): WhatsAppChannelPublic {
  return {
    id: channel.id,
    name: channel.name,
    displayName: channel.displayName,
    phoneNumber: channel.phoneNumber,
    phoneNumberId: channel.phoneNumberId,
    businessAccountId: channel.businessAccountId,
    status: channel.status,
    isActive: channel.isActive,
    assignedUserId: channel.assignedUserId,
    lastWebhookAt: channel.lastWebhookAt,
    lastMessageAt: channel.lastMessageAt,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    conversationCount: channel._count?.conversations,
  };
}

export function sanitizeChannelError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/access[_-]?token["\s:=]+["']?[^"'&\s]+/gi, "access_token=[REDACTED]");
}

/**
 * Ensures a default WhatsAppChannel exists from ClinicSettings/ENV.
 * Seeds credentials only when the channel is missing or still has placeholders.
 * Never overwrites a real DB accessToken/phoneNumberId on restart — that caused
 * valid UI-saved tokens to be replaced by stale ENV values after every deploy.
 */
export async function ensureDefaultWhatsAppChannel(): Promise<WhatsAppChannel> {
  dotenv.config({ override: true });
  const cfg = await getWhatsAppConfig();
  const existing = await prisma.whatsAppChannel.findUnique({
    where: { id: DEFAULT_WHATSAPP_CHANNEL_ID },
  });

  const phoneNumberId = !isPlaceholder(cfg.phoneNumberId)
    ? cfg.phoneNumberId
    : existing && !isPlaceholder(existing.phoneNumberId)
      ? existing.phoneNumberId
      : SEED_PHONE;
  const accessToken = !isPlaceholder(cfg.accessToken)
    ? cfg.accessToken
    : existing && !isPlaceholder(existing.accessToken)
      ? existing.accessToken
      : SEED_TOKEN;
  const businessAccountId = !isPlaceholder(cfg.businessAccountId)
    ? cfg.businessAccountId
    : existing?.businessAccountId ?? null;

  if (!existing) {
    return prisma.whatsAppChannel.create({
      data: {
        id: DEFAULT_WHATSAPP_CHANNEL_ID,
        name: "Default WhatsApp",
        displayName: "Default WhatsApp",
        phoneNumber: "unknown",
        phoneNumberId,
        accessToken,
        businessAccountId,
        status: WhatsAppChannelStatus.PENDING,
        isActive: true,
      },
    });
  }

  // Seed placeholders only — do not clobber tokens saved via the Channels UI.
  const shouldSeedToken =
    isPlaceholder(existing.accessToken) && !isPlaceholder(cfg.accessToken);
  const shouldSeedPhoneId =
    isPlaceholder(existing.phoneNumberId) && !isPlaceholder(cfg.phoneNumberId);
  const shouldUpdateWaba =
    !!businessAccountId &&
    !existing.businessAccountId &&
    businessAccountId !== existing.businessAccountId;

  if (shouldSeedToken || shouldSeedPhoneId || shouldUpdateWaba) {
    return prisma.whatsAppChannel.update({
      where: { id: existing.id },
      data: {
        ...(shouldSeedPhoneId ? { phoneNumberId: cfg.phoneNumberId } : {}),
        ...(shouldSeedToken ? { accessToken: cfg.accessToken } : {}),
        ...(shouldUpdateWaba ? { businessAccountId } : {}),
        // Keep CONNECTED if we only filled missing WABA; otherwise leave status.
        ...(shouldSeedToken || shouldSeedPhoneId
          ? { status: WhatsAppChannelStatus.PENDING }
          : {}),
      },
    });
  }

  return existing;
}

export async function assertChannelLimit(extra = 1): Promise<void> {
  const count = await prisma.whatsAppChannel.count();
  if (count + extra > MAX_WHATSAPP_CHANNELS) {
    throw new ChannelLimitError();
  }
}

export async function listChannels(): Promise<WhatsAppChannelPublic[]> {
  const rows = await prisma.whatsAppChannel.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { conversations: true } } },
  });
  return rows.map(toPublicChannel);
}

export async function listChannelsPublicSummary() {
  return prisma.whatsAppChannel.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      displayName: true,
      phoneNumber: true,
      status: true,
      isActive: true,
    },
  });
}

export async function getChannelById(id: string): Promise<WhatsAppChannel> {
  const channel = await prisma.whatsAppChannel.findUnique({ where: { id } });
  if (!channel) throw new ChannelNotFoundError();
  return channel;
}

export async function findChannelByPhoneNumberId(
  phoneNumberId: string
): Promise<WhatsAppChannel | null> {
  if (!phoneNumberId) return null;
  return prisma.whatsAppChannel.findUnique({ where: { phoneNumberId } });
}

/**
 * Resolve inbound Meta metadata.phone_number_id → channel.
 * Throws UnknownPhoneNumberIdError when not found (caller must not create conversation).
 */
export async function resolveChannelFromPhoneNumberId(
  phoneNumberId: string | null | undefined
): Promise<WhatsAppChannel> {
  if (!phoneNumberId) {
    throw new UnknownPhoneNumberIdError("(missing)");
  }
  const channel = await findChannelByPhoneNumberId(phoneNumberId);
  if (!channel || !channel.isActive) {
    throw new UnknownPhoneNumberIdError(phoneNumberId);
  }
  return channel;
}

export async function getChannelCredentials(
  channelId: string
): Promise<WhatsAppChannelCredentials> {
  const channel = await getChannelById(channelId);
  if (isPlaceholder(channel.accessToken) || isPlaceholder(channel.phoneNumberId)) {
    const { WhatsAppSendError } = await import("./whatsapp-send-error");
    throw new WhatsAppSendError({
      code: "CHANNEL_NOT_CONNECTED",
      message: "WhatsApp channel credentials are not configured",
      agentMessage: "قناة واتساب غير مهيأة. راجع المسؤول.",
      adminMessage:
        "بيانات القناة غير مكتملة. حدّث Access Token و Phone Number ID من الإعدادات ← أرقام واتساب.",
    });
  }
  if (!channel.isActive) {
    const { WhatsAppSendError } = await import("./whatsapp-send-error");
    throw new WhatsAppSendError({
      code: "CHANNEL_NOT_CONNECTED",
      message: "WhatsApp channel is inactive",
      agentMessage: "قناة واتساب معطّلة حاليًا. راجع المسؤول.",
      adminMessage: "القناة معطّلة. فعّلها من الإعدادات ← أرقام واتساب.",
    });
  }
  // Do not block outbound solely on cached status (PENDING/ERROR). Credentials
  // are the source of truth; Meta rejects expired tokens on the send call.
  if (channel.status === WhatsAppChannelStatus.DISCONNECTED) {
    const { WhatsAppSendError } = await import("./whatsapp-send-error");
    throw new WhatsAppSendError({
      code: "CHANNEL_NOT_CONNECTED",
      message: `WhatsApp channel status is ${channel.status}`,
      agentMessage: "قناة واتساب غير متصلة. راجع المسؤول.",
      adminMessage:
        "القناة مفصولة. فعّلها وشغّل اختبار الاتصال من الإعدادات ← أرقام واتساب.",
    });
  }
  return {
    channelId: channel.id,
    phoneNumberId: channel.phoneNumberId,
    accessToken: channel.accessToken,
    businessAccountId: channel.businessAccountId,
    isActive: channel.isActive,
    status: channel.status,
  };
}

/**
 * Credentials for outbound: prefer conversation/campaign channelId.
 * Fallback: default DB channel (never ENV when a real channel row exists with tokens).
 */
export async function resolveSendCredentials(
  channelId?: string | null
): Promise<WhatsAppChannelCredentials> {
  if (channelId) {
    return getChannelCredentials(channelId);
  }
  await ensureDefaultWhatsAppChannel();
  const active = await prisma.whatsAppChannel.findFirst({
    where: {
      isActive: true,
      NOT: {
        OR: [
          { phoneNumberId: SEED_PHONE },
          { accessToken: SEED_TOKEN },
        ],
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (active) {
    return getChannelCredentials(active.id);
  }
  return getChannelCredentials(DEFAULT_WHATSAPP_CHANNEL_ID);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").trim();
}

export async function createChannel(input: {
  name: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string | null;
  isActive?: boolean;
  assignedUserId?: string | null;
}): Promise<WhatsAppChannelPublic> {
  await assertChannelLimit(1);

  const phoneNumber = normalizePhone(input.phoneNumber);
  const phoneNumberId = input.phoneNumberId.trim();
  const accessToken = input.accessToken.trim();

  if (!phoneNumberId) throw new Error("phoneNumberId is required");
  if (!accessToken) throw new Error("accessToken is required");
  if (!phoneNumber || phoneNumber.length < 8) {
    throw new Error("Invalid phone number format");
  }

  const dupId = await prisma.whatsAppChannel.findUnique({
    where: { phoneNumberId },
  });
  if (dupId) throw new Error("A channel with this phoneNumberId already exists");

  const dupPhone = await prisma.whatsAppChannel.findFirst({
    where: { phoneNumber },
  });
  if (dupPhone) throw new Error("A channel with this phone number already exists");

  const channel = await prisma.whatsAppChannel.create({
    data: {
      name: input.name.trim() || "WhatsApp",
      displayName: input.displayName.trim() || input.name.trim() || "WhatsApp",
      phoneNumber,
      phoneNumberId,
      accessToken,
      businessAccountId: input.businessAccountId?.trim() || null,
      isActive: input.isActive !== false,
      assignedUserId: input.assignedUserId || null,
      status: WhatsAppChannelStatus.PENDING,
    },
  });

  await testChannelConnection(channel.id);
  const fresh = await getChannelById(channel.id);
  return toPublicChannel({ ...fresh, _count: { conversations: 0 } });
}

export async function updateChannel(
  id: string,
  input: {
    name?: string;
    displayName?: string;
    phoneNumber?: string;
    phoneNumberId?: string;
    accessToken?: string;
    businessAccountId?: string | null;
    isActive?: boolean;
    assignedUserId?: string | null;
    status?: string;
  }
): Promise<WhatsAppChannelPublic> {
  const existing = await getChannelById(id);
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name.trim();
  if (input.displayName !== undefined) data.displayName = input.displayName.trim();
  if (input.phoneNumber !== undefined) {
    const phoneNumber = normalizePhone(input.phoneNumber);
    if (!phoneNumber || phoneNumber.length < 8) {
      throw new Error("Invalid phone number format");
    }
    const dup = await prisma.whatsAppChannel.findFirst({
      where: { phoneNumber, NOT: { id } },
    });
    if (dup) throw new Error("A channel with this phone number already exists");
    data.phoneNumber = phoneNumber;
  }
  if (input.phoneNumberId !== undefined) {
    const phoneNumberId = input.phoneNumberId.trim();
    if (!phoneNumberId) throw new Error("phoneNumberId is required");
    const dup = await prisma.whatsAppChannel.findFirst({
      where: { phoneNumberId, NOT: { id } },
    });
    if (dup) throw new Error("A channel with this phoneNumberId already exists");
    data.phoneNumberId = phoneNumberId;
  }
  if (input.accessToken !== undefined && input.accessToken.trim()) {
    data.accessToken = input.accessToken.trim();
  }
  if (input.businessAccountId !== undefined) {
    data.businessAccountId = input.businessAccountId?.trim() || null;
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.assignedUserId !== undefined) data.assignedUserId = input.assignedUserId;
  if (input.status !== undefined) data.status = input.status;

  const credsChanged =
    (typeof data.accessToken === "string" && data.accessToken.length > 0) ||
    typeof data.phoneNumberId === "string";

  await prisma.whatsAppChannel.update({
    where: { id: existing.id },
    data,
  });

  // After token/phone id changes, validate against Meta immediately so the
  // channel becomes CONNECTED without a separate Test click.
  if (credsChanged) {
    await testChannelConnection(id);
  }

  const updated = await prisma.whatsAppChannel.findUniqueOrThrow({
    where: { id: existing.id },
    include: { _count: { select: { conversations: true } } },
  });
  return toPublicChannel(updated);
}

export async function setChannelActive(
  id: string,
  isActive: boolean
): Promise<WhatsAppChannelPublic> {
  await prisma.whatsAppChannel.update({
    where: { id },
    data: {
      isActive,
      status: isActive
        ? WhatsAppChannelStatus.PENDING
        : WhatsAppChannelStatus.DISCONNECTED,
    },
  });

  if (isActive) {
    await testChannelConnection(id);
  }

  const updated = await prisma.whatsAppChannel.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { conversations: true } } },
  });
  return toPublicChannel(updated);
}

export async function deleteChannel(id: string): Promise<void> {
  const channel = await getChannelById(id);
  const conversations = await prisma.conversation.count({
    where: { channelId: id },
  });
  if (conversations > 0) {
    const err = new Error(
      "Cannot delete channel while conversations exist. Deactivate it instead."
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
  const contacts = await prisma.contact.count({
    where: { whatsAppChannelId: id },
  });
  if (contacts > 0) {
    const err = new Error(
      "Cannot delete channel while contacts exist. Deactivate it instead."
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
  if (channel.id === DEFAULT_WHATSAPP_CHANNEL_ID) {
    const remaining = await prisma.whatsAppChannel.count();
    if (remaining <= 1) {
      const err = new Error(
        "Cannot delete the only WhatsApp channel."
      ) as Error & { statusCode?: number };
      err.statusCode = 409;
      throw err;
    }
  }
  await prisma.whatsAppChannel.delete({ where: { id } });
}

export async function testChannelConnection(id: string): Promise<{
  status: "CONNECTED" | "ERROR";
  message: string;
}> {
  const channel = await getChannelById(id);
  if (isPlaceholder(channel.accessToken) || isPlaceholder(channel.phoneNumberId)) {
    await prisma.whatsAppChannel.update({
      where: { id },
      data: { status: WhatsAppChannelStatus.ERROR },
    });
    return {
      status: "ERROR",
      message: "Channel credentials are incomplete",
    };
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${channel.phoneNumberId}`;
    const { data } = await axios.get<{
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      error?: { message?: string };
    }>(url, {
      headers: { Authorization: `Bearer ${channel.accessToken}` },
      params: { fields: "id,display_phone_number,verified_name" },
      timeout: 15000,
    });

    if (!data.id) {
      throw new Error("Meta did not return phone number details");
    }

    await prisma.whatsAppChannel.update({
      where: { id },
      data: {
        status: WhatsAppChannelStatus.CONNECTED,
        ...(data.display_phone_number
          ? { phoneNumber: normalizePhone(data.display_phone_number) }
          : {}),
        ...(data.verified_name
          ? { displayName: data.verified_name }
          : {}),
      },
    });

    return { status: "CONNECTED", message: "Connection successful" };
  } catch (error) {
    let message = "Failed to connect to Meta API";
    if (axios.isAxiosError(error)) {
      const metaMsg = (error.response?.data as { error?: { message?: string } })
        ?.error?.message;
      message = sanitizeChannelError(metaMsg || error.message || message);
    } else if (error instanceof Error) {
      message = sanitizeChannelError(error.message);
    }

    await prisma.whatsAppChannel.update({
      where: { id },
      data: { status: WhatsAppChannelStatus.ERROR },
    });

    return { status: "ERROR", message };
  }
}

export async function touchChannelWebhook(channelId: string): Promise<void> {
  await prisma.whatsAppChannel.update({
    where: { id: channelId },
    data: { lastWebhookAt: new Date() },
  });
}

export async function touchChannelMessage(channelId: string): Promise<void> {
  await prisma.whatsAppChannel.update({
    where: { id: channelId },
    data: { lastMessageAt: new Date() },
  });
}

export async function getChannelsHealthSnapshot() {
  const channels = await prisma.whatsAppChannel.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      displayName: true,
      phoneNumber: true,
      status: true,
      isActive: true,
      lastWebhookAt: true,
      lastMessageAt: true,
    },
  });
  return channels;
}
