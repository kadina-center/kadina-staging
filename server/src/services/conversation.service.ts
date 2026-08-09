import { prisma } from "../lib/prisma";
import { ensureDefaultWhatsAppChannel } from "./whatsapp-channel.service";

const channelSelect = {
  id: true,
  name: true,
  displayName: true,
  phoneNumber: true,
  status: true,
  isActive: true,
} as const;

/**
 * Ensures a Conversation exists for a Contact (creates open one if missing)
 * and bumps lastMessageAt on both Conversation and Contact.
 * WhatsApp threads must always have channelId (clinic number).
 */
export async function touchConversation(
  contactId: string,
  channelId?: string | null
) {
  const now = new Date();

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, whatsAppChannelId: true, channel: true },
  });

  let resolvedChannelId =
    channelId || contact?.whatsAppChannelId || null;

  if (!resolvedChannelId) {
    const existing = await prisma.conversation.findUnique({
      where: { contactId },
      select: { channelId: true },
    });
    resolvedChannelId = existing?.channelId ?? null;
  }

  if (!resolvedChannelId) {
    resolvedChannelId = (await ensureDefaultWhatsAppChannel()).id;
  }

  const conversation = await prisma.conversation.upsert({
    where: { contactId },
    create: {
      contactId,
      channelId: resolvedChannelId,
      status: "open",
      lastMessageAt: now,
    },
    update: {
      lastMessageAt: now,
      ...(channelId ? { channelId } : {}),
    },
    include: {
      contact: true,
      assignedTo: true,
      tags: true,
      channel: { select: channelSelect },
    },
  });

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      lastMessageAt: now,
      ...(channelId && contact?.channel === "whatsapp"
        ? { whatsAppChannelId: channelId, channelScope: channelId }
        : {}),
    },
  });

  return conversation;
}

export const conversationInclude = {
  contact: {
    include: {
      messages: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
      },
    },
  },
  assignedTo: {
    select: { id: true, name: true, email: true, role: true },
  },
  assignedBy: {
    select: { id: true, name: true, email: true, role: true },
  },
  lockedBy: {
    select: { id: true, name: true, email: true, role: true },
  },
  tags: true,
  channel: {
    select: channelSelect,
  },
};

/**
 * Record first human (non-AI) response time once per conversation.
 */
export async function markFirstHumanResponse(
  contactId: string
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { contactId },
  });
  if (!conversation || conversation.firstResponseAt) return;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { firstResponseAt: new Date() },
  });
}

/** Update Contact.lastAgentId after a human ADMIN/AGENT outbound reply. */
export function touchLastAgent(
  contactId: string,
  userId: string | null | undefined
): void {
  if (!userId) return;
  void prisma.contact
    .update({
      where: { id: contactId },
      data: { lastAgentId: userId },
    })
    .catch((error) => {
      console.error("[contacts] touchLastAgent failed:", error);
    });
}
