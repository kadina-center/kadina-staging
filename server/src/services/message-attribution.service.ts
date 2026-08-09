import { prisma } from "../lib/prisma";
import type { AuthUser } from "../middleware/auth";

/** Canonical senderType values stored on Message */
export type SenderType =
  | "ADMIN"
  | "AGENT"
  | "AI"
  | "SYSTEM"
  | "AUTOMATION"
  | "BOT";

export type MessageAttribution = {
  createdByUserId: string | null;
  createdByName: string;
  createdByRole: string;
  createdByAvatar: string | null;
  senderType: SenderType;
  sentByAi: boolean;
};

const CANONICAL: SenderType[] = [
  "ADMIN",
  "AGENT",
  "AI",
  "SYSTEM",
  "AUTOMATION",
  "BOT",
];

/** Normalize legacy lowercase / mixed values to UPPERCASE canonical form */
export function normalizeSenderType(
  value?: string | null,
  sentByAi?: boolean
): SenderType | null {
  if (!value) {
    if (sentByAi) return "BOT";
    return null;
  }
  const upper = value.trim().toUpperCase();
  if ((CANONICAL as string[]).includes(upper)) return upper as SenderType;
  return null;
}

export function attributionFromUser(user: {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string | null;
}): MessageAttribution {
  const isAdmin = user.role === "admin";
  return {
    createdByUserId: user.id,
    createdByName: user.name,
    createdByRole: isAdmin ? "admin" : "agent",
    createdByAvatar: user.avatarUrl ?? null,
    senderType: isAdmin ? "ADMIN" : "AGENT",
    sentByAi: false,
  };
}

export function attributionBot(name = "Bot"): MessageAttribution {
  return {
    createdByUserId: null,
    createdByName: name,
    createdByRole: "bot",
    createdByAvatar: null,
    senderType: "BOT",
    sentByAi: true,
  };
}

export function attributionAi(name = "AI"): MessageAttribution {
  return {
    createdByUserId: null,
    createdByName: name,
    createdByRole: "ai",
    createdByAvatar: null,
    senderType: "AI",
    sentByAi: true,
  };
}

export function attributionAutomation(
  name = "Automation"
): MessageAttribution {
  return {
    createdByUserId: null,
    createdByName: name,
    createdByRole: "automation",
    createdByAvatar: null,
    senderType: "AUTOMATION",
    sentByAi: true,
  };
}

/** Welcome / away / clinic system notices */
export function attributionSystem(name = "System"): MessageAttribution {
  return {
    createdByUserId: null,
    createdByName: name,
    createdByRole: "system",
    createdByAvatar: null,
    senderType: "SYSTEM",
    sentByAi: true,
  };
}

/**
 * Resolve attribution from the authenticated request user.
 * Snapshots name/role/avatar at send time so later renames don't rewrite history.
 */
export async function attributionFromRequest(
  user?: AuthUser | null
): Promise<MessageAttribution> {
  if (!user?.id) return attributionSystem();

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, role: true, avatarUrl: true },
  });

  if (dbUser) return attributionFromUser(dbUser);

  return attributionFromUser({
    id: user.id,
    name: user.name,
    role: user.role,
    avatarUrl: null,
  });
}

export function attributionToPrismaData(attr: MessageAttribution) {
  return {
    createdByUserId: attr.createdByUserId,
    createdByName: attr.createdByName,
    createdByRole: attr.createdByRole,
    createdByAvatar: attr.createdByAvatar,
    senderType: attr.senderType,
    sentByAi: attr.sentByAi,
  };
}

export function attributionAuditMeta(attr: MessageAttribution) {
  return {
    createdByUserId: attr.createdByUserId,
    createdByName: attr.createdByName,
    createdByRole: attr.createdByRole,
    senderType: attr.senderType,
  };
}

/** Fields for API / Socket consumers (snapshot + aliases) */
export function messageAttributionFields(message: {
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  createdByAvatar?: string | null;
  /** @deprecated legacy column name before rename */
  senderAvatar?: string | null;
  senderType?: string | null;
  sentByAi?: boolean;
}) {
  const avatar =
    message.createdByAvatar ?? message.senderAvatar ?? null;
  const senderType = normalizeSenderType(
    message.senderType,
    message.sentByAi
  );
  return {
    createdByUserId: message.createdByUserId ?? null,
    createdByName: message.createdByName ?? null,
    createdByRole: message.createdByRole ?? null,
    createdByAvatar: avatar,
    senderType,
    sentByAi: message.sentByAi ?? false,
    // Socket / UI aliases (no extra queries)
    senderUserId: message.createdByUserId ?? null,
    senderName: message.createdByName ?? null,
    senderRole: message.createdByRole ?? null,
    senderAvatar: avatar,
  };
}

/** Preview label for conversation list */
export function formatOutboundPreview(
  message: {
    content: string;
    direction: string;
    createdByName?: string | null;
    senderType?: string | null;
    sentByAi?: boolean;
  },
  maxLen = 80
): string {
  const body = (message.content || "").replace(/\s+/g, " ").trim();
  const clipped =
    body.length > maxLen ? `${body.slice(0, maxLen - 1)}…` : body;

  if (message.direction !== "outbound") return clipped;

  const type = normalizeSenderType(message.senderType, message.sentByAi);
  const name = message.createdByName?.trim();

  if (type === "AI") return `🤖 ${name || "AI"}: ${clipped}`;
  if (type === "AUTOMATION") return `⚙ ${name || "Automation"}: ${clipped}`;
  if (type === "BOT") return `🤖 ${name || "Bot"}: ${clipped}`;
  if (type === "SYSTEM") return `⚙ ${name || "System"}: ${clipped}`;
  if (name) return `${name}: ${clipped}`;
  return clipped;
}
