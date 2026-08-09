import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../middleware/auth";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "./audit.service";

export type ConversationAccessFields = {
  id: string;
  assignedToId: string | null;
  contactId?: string;
};

export function isAdmin(user?: AuthUser | null): boolean {
  return user?.role === "admin";
}

/** True if user may read/write this conversation. */
export function canAccessConversation(
  user: AuthUser | null | undefined,
  conversation: ConversationAccessFields | null | undefined
): boolean {
  if (!user || !conversation) return false;
  if (isAdmin(user)) return true;
  return conversation.assignedToId === user.id;
}

/** Agent inbox: only conversations assigned to them. Admin: no forced filter. */
export function visibilityWhereForUser(
  user: AuthUser | null | undefined
): Prisma.ConversationWhereInput {
  if (!user) return { id: "__none__" };
  if (isAdmin(user)) return {};
  return { assignedToId: user.id };
}

/**
 * Merge caller filters with role visibility.
 * Agents cannot widen scope via assignedToId query (ignored / forced to self).
 */
export function applyVisibilityToWhere(
  user: AuthUser | null | undefined,
  where: Prisma.ConversationWhereInput
): Prisma.ConversationWhereInput {
  const vis = visibilityWhereForUser(user);
  if (isAdmin(user)) return where;
  return {
    AND: [where, vis],
  };
}

const accessByConversationCache = new Map<
  string,
  { at: number; value: ConversationAccessFields | null }
>();
const ACCESS_CACHE_TTL_MS = 4000;

/** Drop cached assignee lookups after assign/reassign/takeover. */
export function invalidateConversationAccessCache(
  conversationId?: string | null
): void {
  if (!conversationId) {
    accessByConversationCache.clear();
    return;
  }
  accessByConversationCache.delete(conversationId);
}

export async function getConversationAccess(
  conversationId: string
): Promise<ConversationAccessFields | null> {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, assignedToId: true, contactId: true },
  });
}

/**
 * Short TTL cache for high-frequency socket presence/typing checks.
 * Do not use for HTTP authorization decisions.
 */
export async function getConversationAccessCached(
  conversationId: string
): Promise<ConversationAccessFields | null> {
  const hit = accessByConversationCache.get(conversationId);
  if (hit && Date.now() - hit.at < ACCESS_CACHE_TTL_MS) {
    return hit.value;
  }
  const value = await getConversationAccess(conversationId);
  accessByConversationCache.set(conversationId, { at: Date.now(), value });
  return value;
}

export async function getConversationAccessByContact(
  contactId: string
): Promise<ConversationAccessFields | null> {
  return prisma.conversation.findUnique({
    where: { contactId },
    select: { id: true, assignedToId: true, contactId: true },
  });
}

/** Contact is accessible if its conversation is accessible (1:1 today). */
export async function canAccessContact(
  user: AuthUser | null | undefined,
  contactId: string
): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const conv = await getConversationAccessByContact(contactId);
  return canAccessConversation(user, conv);
}

/**
 * Individual resource denial → 404 (anti-enumeration).
 * Admin-only endpoints should use requireAdmin → 403 instead.
 */
function denyIndividualResource(
  req: Request,
  res: Response,
  opts: {
    entityType: string;
    entityId: string;
    reason: string;
  }
): null {
  void logAuditFromRequest(req, {
    action: AuditAction.READ,
    entityType: opts.entityType,
    entityId: opts.entityId,
    status: "FAILED",
    metadata: {
      kind: "access_denied",
      reason: opts.reason,
      // No PII (phones/names) in audit
    },
  });
  res.status(404).json({ error: "Not found" });
  return null;
}

export async function assertCanAccessConversation(
  req: Request,
  res: Response,
  conversationId: string
): Promise<ConversationAccessFields | null> {
  const conv = await getConversationAccess(conversationId);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return null;
  }
  if (!canAccessConversation(req.user, conv)) {
    return denyIndividualResource(req, res, {
      entityType: AuditEntity.CONVERSATION,
      entityId: conversationId,
      reason: "conversation_not_assigned",
    });
  }
  return conv;
}

export async function assertCanAccessContact(
  req: Request,
  res: Response,
  contactId: string
): Promise<ConversationAccessFields | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return null;
  }
  const conv = await getConversationAccessByContact(contactId);
  // No conversation yet: admin only (still 404 for agents — no enumeration)
  if (!conv) {
    if (!isAdmin(req.user)) {
      return denyIndividualResource(req, res, {
        entityType: AuditEntity.CONTACT,
        entityId: contactId,
        reason: "contact_no_conversation_or_unassigned",
      });
    }
    return { id: "", assignedToId: null, contactId };
  }
  if (!canAccessConversation(req.user, conv)) {
    return denyIndividualResource(req, res, {
      entityType: AuditEntity.CONTACT,
      entityId: contactId,
      reason: "contact_not_assigned",
    });
  }
  return conv;
}

/** Contact IDs an agent may see (via assigned conversations). */
export function contactVisibilityWhereForUser(
  user: AuthUser | null | undefined
): Prisma.ContactWhereInput {
  if (!user) return { id: "__none__" };
  if (isAdmin(user)) return {};
  return {
    conversation: {
      assignedToId: user.id,
    },
  };
}
