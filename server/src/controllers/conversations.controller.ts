import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import {
  applyVisibilityToWhere,
  assertCanAccessConversation,
  invalidateConversationAccessCache,
  isAdmin,
} from "../services/conversation-access.service";
import { conversationInclude } from "../services/conversation.service";
import { stopFlow } from "../services/flow-engine.service";
import { emitConversationUpdated } from "../services/socket.service";
import { dispatchEvent } from "../services/webhook-dispatcher.service";
import { messageAttributionFields } from "../services/message-attribution.service";
import {
  TimelineEventType,
  actorFromUser,
  logTimeline,
} from "../services/timeline.service";
import { parseCursor, parseLimit } from "../utils/pagination";

function mapConversation(conversation: {
  id: string;
  contactId: string;
  channelId?: string | null;
  channel?: {
    id: string;
    name: string;
    displayName: string;
    phoneNumber: string;
    status?: string;
    isActive?: boolean;
  } | null;
  status: string;
  assignedToId: string | null;
  assignedAt?: Date | null;
  assignedByUserId?: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  pinned: boolean;
  archived: boolean;
  unreadCount: number;
  lastReadAt: Date | null;
  lockedById: string | null;
  lockedAt: Date | null;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    channel: string;
    channelUserId: string | null;
    lastMessageAt: Date;
    createdAt: Date;
    crmStatus: string;
    customNotes: string | null;
    messages: Array<{
      id: string;
      content: string;
      direction: string;
      createdAt: Date;
      status: string;
      createdByUserId?: string | null;
      createdByName?: string | null;
      createdByRole?: string | null;
      createdByAvatar?: string | null;
      senderType?: string | null;
      sentByAi?: boolean;
    }>;
  };
  assignedTo: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  assignedBy?: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  lockedBy: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  tags: Array<{ id: string; name: string; color: string }>;
}) {
  return {
    id: conversation.id,
    contactId: conversation.contactId,
    channelId: conversation.channelId ?? null,
    channel: conversation.channel
      ? {
          id: conversation.channel.id,
          name: conversation.channel.name,
          displayName: conversation.channel.displayName,
          phoneNumber: conversation.channel.phoneNumber,
        }
      : null,
    status: conversation.status,
    assignedToId: conversation.assignedToId,
    assignedAt: conversation.assignedAt ?? null,
    assignedByUserId: conversation.assignedByUserId ?? null,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    pinned: conversation.pinned,
    archived: conversation.archived,
    unreadCount: conversation.unreadCount,
    lastReadAt: conversation.lastReadAt,
    lockedById: conversation.lockedById,
    lockedAt: conversation.lockedAt,
    lockedBy: conversation.lockedBy,
    contact: {
      id: conversation.contact.id,
      phone: conversation.contact.phone,
      name: conversation.contact.name,
      channel: conversation.contact.channel,
      channelUserId: conversation.contact.channelUserId,
      lastMessageAt: conversation.contact.lastMessageAt,
      createdAt: conversation.contact.createdAt,
      crmStatus: conversation.contact.crmStatus,
      customNotes: conversation.contact.customNotes,
      lastMessage: conversation.contact.messages[0]
        ? {
            id: conversation.contact.messages[0].id,
            content: conversation.contact.messages[0].content,
            direction: conversation.contact.messages[0].direction,
            createdAt: conversation.contact.messages[0].createdAt,
            status: conversation.contact.messages[0].status,
            ...messageAttributionFields(conversation.contact.messages[0]),
          }
        : null,
    },
    assignedTo: conversation.assignedTo,
    assignedBy: conversation.assignedBy ?? null,
    tags: conversation.tags,
  };
}

function parseBoolQuery(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

export async function listConversations(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const {
      status,
      assignedToId,
      tag,
      channel,
      channelId,
      search,
      pinned,
      archived,
      cursor,
      limit,
    } = req.query;

    let where: Prisma.ConversationWhereInput = {};

    if (typeof channelId === "string" && channelId.trim()) {
      where.channelId = channelId.trim();
    }

    if (typeof status === "string" && status.trim()) {
      where.status = status.trim();
    }

    if (typeof assignedToId === "string") {
      where.assignedToId =
        assignedToId === "null" || assignedToId === ""
          ? null
          : assignedToId;
    }

    if (typeof tag === "string" && tag.trim()) {
      const value = tag.trim();
      where.tags = {
        some: { OR: [{ id: value }, { name: value }] },
      };
    }

    const pinnedFilter = parseBoolQuery(pinned);
    if (pinnedFilter !== undefined) {
      where.pinned = pinnedFilter;
    }

    const archivedFilter = parseBoolQuery(archived);
    if (archivedFilter !== undefined) {
      where.archived = archivedFilter;
    }

    const contactWhere: Prisma.ContactWhereInput = {};
    if (typeof channel === "string" && channel.trim()) {
      contactWhere.channel = channel.trim();
    }
    if (typeof search === "string" && search.trim()) {
      const q = search.trim();
      contactWhere.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ];
    }
    if (Object.keys(contactWhere).length > 0) {
      where.contact = contactWhere;
    }

    where = applyVisibilityToWhere(req.user, where);

    const take = parseLimit(limit, 30);

    // Legacy shape: full unpaginated array when no pagination requested.
    if (take === undefined) {
      const conversations = await prisma.conversation.findMany({
        where,
        orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
        include: conversationInclude,
      });
      res.json(conversations.map(mapConversation));
      return;
    }

    const cursorId = parseCursor(cursor);
    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
      include: conversationInclude,
      take: take + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = conversations.length > take;
    const page = hasMore ? conversations.slice(0, take) : conversations;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    res.json({
      items: page.map(mapConversation),
      nextCursor,
    });
  } catch (error) {
    console.error("[conversations] list error:", error);
    res.status(500).json({ error: "Failed to list conversations" });
  }
}

export async function updateConversationStatus(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const { status } = req.body as { status?: string };

    if (!status || !["open", "pending", "closed"].includes(status)) {
      res
        .status(400)
        .json({ error: "status must be open, pending, or closed" });
      return;
    }

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { status },
      include: conversationInclude,
    });

    const oldStatus = existing.status;
    let eventType: string | null = null;
    let title = "";
    if (status === "closed" && oldStatus !== "closed") {
      eventType = TimelineEventType.CONVERSATION_CLOSED;
      title = "إغلاق المحادثة";
    } else if (oldStatus === "closed" && status !== "closed") {
      eventType = TimelineEventType.CONVERSATION_REOPENED;
      title = "إعادة فتح المحادثة";
    } else if (status === "open" && oldStatus !== "open" && oldStatus !== "closed") {
      eventType = TimelineEventType.CONVERSATION_OPENED;
      title = "فتح المحادثة";
    }

    if (eventType) {
      void logTimeline({
        contactId: conversation.contactId,
        conversationId: conversation.id,
        eventType,
        title,
        description: `${oldStatus} → ${status}`,
        actor: actorFromUser(req.user),
        metadata: { oldStatus, newStatus: status },
      });
    }

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    res.json(payload);
  } catch (error) {
    console.error("[conversations] status error:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
}

export async function assignConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!isAdmin(req.user)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { userId } = req.body as { userId?: string | null };

    if (userId !== null && userId !== undefined && typeof userId !== "string") {
      res.status(400).json({ error: "userId must be a string or null" });
      return;
    }

    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
    }

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const nextAssignedToId = userId ?? null;

    if (nextAssignedToId) {
      await stopFlow(existing.contactId);
    }

    invalidateConversationAccessCache(id);

    const conversation = await prisma.conversation.update({
      where: { id },
      data: (nextAssignedToId
        ? {
            assignedToId: nextAssignedToId,
            assignedAt: new Date(),
            assignedByUserId: req.user!.id,
          }
        : {
            assignedToId: null,
            assignedAt: null,
            assignedByUserId: null,
          }) as Prisma.ConversationUncheckedUpdateInput,
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload, existing.assignedToId);

    void dispatchEvent("conversation.assigned", {
      conversationId: conversation.id,
      contactId: conversation.contactId,
      assignedToId: conversation.assignedToId,
      assignedTo: conversation.assignedTo
        ? {
            id: conversation.assignedTo.id,
            name: conversation.assignedTo.name,
            email: conversation.assignedTo.email,
          }
        : null,
      contact: {
        id: conversation.contact.id,
        phone: conversation.contact.phone,
        name: conversation.contact.name,
        channel: conversation.contact.channel,
      },
    });

    if (nextAssignedToId !== existing.assignedToId) {
      if (nextAssignedToId) {
        const isTransfer =
          !!existing.assignedToId && existing.assignedToId !== nextAssignedToId;
        logAuditFromRequest(req, {
          action: isTransfer ? AuditAction.TRANSFER : AuditAction.ASSIGN,
          entityType: AuditEntity.CONVERSATION,
          entityId: conversation.id,
          oldValues: { assignedToId: existing.assignedToId },
          newValues: { assignedToId: nextAssignedToId },
          metadata: {
            conversationId: conversation.id,
            contactId: conversation.contactId,
            assignedToName: conversation.assignedTo?.name ?? null,
          },
        });
        void logTimeline({
          contactId: conversation.contactId,
          conversationId: conversation.id,
          eventType: existing.assignedToId
            ? TimelineEventType.ASSIGNMENT_CHANGED
            : TimelineEventType.ASSIGNMENT_CREATED,
          title: existing.assignedToId ? "تغيير التعيين" : "تعيين المحادثة",
          description: conversation.assignedTo?.name ?? undefined,
          actor: actorFromUser(req.user),
          metadata: {
            assignedToId: nextAssignedToId,
            previousAssignedToId: existing.assignedToId,
          },
        });
      } else {
        logAuditFromRequest(req, {
          action: AuditAction.ASSIGN,
          entityType: AuditEntity.CONVERSATION,
          entityId: conversation.id,
          oldValues: { assignedToId: existing.assignedToId },
          newValues: { assignedToId: null },
          metadata: {
            conversationId: conversation.id,
            contactId: conversation.contactId,
            reason: "removed",
          },
        });
        void logTimeline({
          contactId: conversation.contactId,
          conversationId: conversation.id,
          eventType: TimelineEventType.ASSIGNMENT_REMOVED,
          title: "إلغاء التعيين",
          actor: actorFromUser(req.user),
          metadata: {
            assignedToId: null,
            previousAssignedToId: existing.assignedToId,
          },
        });
      }
    }

    res.json(payload);
  } catch (error) {
    console.error("[conversations] assign error:", error);
    res.status(500).json({ error: "Failed to assign conversation" });
  }
}

export async function markRead(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        unreadCount: 0,
        lastReadAt: new Date(),
      },
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    void logTimeline({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      eventType: TimelineEventType.MESSAGE_READ,
      title: "تمت قراءة المحادثة",
      actor: actorFromUser(req.user),
      metadata: { unreadCount: 0 },
    });
    res.json(payload);
  } catch (error) {
    console.error("[conversations] markRead error:", error);
    res.status(500).json({ error: "Failed to mark conversation as read" });
  }
}

export async function pinConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const body = req.body as { pinned?: boolean };

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const pinned =
      typeof body.pinned === "boolean" ? body.pinned : !existing.pinned;

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { pinned },
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    res.json(payload);
  } catch (error) {
    console.error("[conversations] pin error:", error);
    res.status(500).json({ error: "Failed to pin conversation" });
  }
}

export async function archiveConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const body = req.body as { archived?: boolean };

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const archived =
      typeof body.archived === "boolean" ? body.archived : !existing.archived;

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { archived },
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    res.json(payload);
  } catch (error) {
    console.error("[conversations] archive error:", error);
    res.status(500).json({ error: "Failed to archive conversation" });
  }
}

export async function takeOver(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Admin: any conversation. Agent: only if already assigned to them (unassigned denied).
    if (!isAdmin(req.user)) {
      if (existing.assignedToId !== userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    await stopFlow(existing.contactId);

    invalidateConversationAccessCache(id);

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        assignedToId: userId,
        assignedAt: new Date(),
        assignedByUserId: userId,
        status: "open",
        archived: false,
      } as Prisma.ConversationUncheckedUpdateInput,
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload, existing.assignedToId);

    void dispatchEvent("conversation.assigned", {
      conversationId: conversation.id,
      contactId: conversation.contactId,
      assignedToId: conversation.assignedToId,
      assignedTo: conversation.assignedTo
        ? {
            id: conversation.assignedTo.id,
            name: conversation.assignedTo.name,
            email: conversation.assignedTo.email,
          }
        : null,
      contact: {
        id: conversation.contact.id,
        phone: conversation.contact.phone,
        name: conversation.contact.name,
        channel: conversation.contact.channel,
      },
      takeover: true,
    });

    logAuditFromRequest(req, {
      action: AuditAction.TAKEOVER,
      entityType: AuditEntity.CONVERSATION,
      entityId: conversation.id,
      oldValues: { assignedToId: existing.assignedToId },
      newValues: { assignedToId: userId },
      metadata: {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        takeover: true,
      },
    });

    void logTimeline({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      eventType: existing.assignedToId
        ? TimelineEventType.ASSIGNMENT_CHANGED
        : TimelineEventType.ASSIGNMENT_CREATED,
      title: "استلام المحادثة",
      description: conversation.assignedTo?.name ?? undefined,
      actor: actorFromUser(req.user),
      metadata: {
        assignedToId: userId,
        previousAssignedToId: existing.assignedToId,
        takeover: true,
      },
    });

    res.json(payload);
  } catch (error) {
    console.error("[conversations] takeover error:", error);
    res.status(500).json({ error: "Failed to take over conversation" });
  }
}

export async function addTagToConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const { tagId } = req.body as { tagId?: string };

    if (!tagId) {
      res.status(400).json({ error: "tagId is required" });
      return;
    }

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        tags: { connect: { id: tagId } },
      },
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.TAG,
      entityId: tagId,
      newValues: { tagId, tagName: tag?.name ?? null },
      metadata: {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        tagId,
        tagName: tag?.name ?? null,
      },
    });
    void logTimeline({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      eventType: TimelineEventType.TAG_ADDED,
      title: "إضافة وسم",
      description: tag?.name ?? tagId,
      actor: actorFromUser(req.user),
      metadata: { tagId, tagName: tag?.name ?? null },
    });
    res.json(payload);
  } catch (error) {
    console.error("[conversations] add tag error:", error);
    res.status(500).json({ error: "Failed to add tag" });
  }
}

const LOCK_STALE_MS = 15 * 60 * 1000; // auto-expire a stale lock after 15 min

export async function lockConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const isStale =
      existing.lockedAt &&
      Date.now() - existing.lockedAt.getTime() > LOCK_STALE_MS;

    if (
      existing.lockedById &&
      existing.lockedById !== userId &&
      !isStale &&
      req.user?.role !== "admin"
    ) {
      res.status(409).json({
        error: "Conversation is locked by another agent",
        lockedById: existing.lockedById,
        lockedAt: existing.lockedAt,
      });
      return;
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { lockedById: userId, lockedAt: new Date() },
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    logAuditFromRequest(req, {
      action: AuditAction.LOCK,
      entityType: AuditEntity.CONVERSATION,
      entityId: id,
      oldValues: {
        lockedById: existing.lockedById,
        lockedAt: existing.lockedAt,
      },
      newValues: {
        lockedById: conversation.lockedById,
        lockedAt: conversation.lockedAt,
      },
      metadata: {
        conversationId: id,
        contactId: conversation.contactId,
      },
    });

    void logTimeline({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      eventType: TimelineEventType.CONVERSATION_LOCKED,
      title: "قفل المحادثة",
      actor: actorFromUser(req.user),
    });

    res.json(payload);
  } catch (error) {
    console.error("[conversations] lock error:", error);
    res.status(500).json({ error: "Failed to lock conversation" });
  }
}

export async function unlockConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    if (
      existing.lockedById &&
      existing.lockedById !== userId &&
      req.user?.role !== "admin"
    ) {
      res.status(403).json({ error: "Only the locking agent or an admin can unlock" });
      return;
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { lockedById: null, lockedAt: null },
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    logAuditFromRequest(req, {
      action: AuditAction.UNLOCK,
      entityType: AuditEntity.CONVERSATION,
      entityId: id,
      oldValues: {
        lockedById: existing.lockedById,
        lockedAt: existing.lockedAt,
      },
      newValues: { lockedById: null, lockedAt: null },
      metadata: {
        conversationId: id,
        contactId: conversation.contactId,
      },
    });

    void logTimeline({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      eventType: TimelineEventType.CONVERSATION_UNLOCKED,
      title: "فتح قفل المحادثة",
      actor: actorFromUser(req.user),
    });

    res.json(payload);
  } catch (error) {
    console.error("[conversations] unlock error:", error);
    res.status(500).json({ error: "Failed to unlock conversation" });
  }
}

export async function removeTagFromConversation(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id, tagId } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        tags: { disconnect: { id: tagId } },
      },
      include: conversationInclude,
    });

    const payload = mapConversation(conversation);
    emitConversationUpdated(payload);
    logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.TAG,
      entityId: tagId,
      oldValues: { tagId, tagName: tag?.name ?? null },
      metadata: {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        tagId,
        tagName: tag?.name ?? null,
      },
    });
    void logTimeline({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      eventType: TimelineEventType.TAG_REMOVED,
      title: "إزالة وسم",
      description: tag?.name ?? tagId,
      actor: actorFromUser(req.user),
      metadata: { tagId, tagName: tag?.name ?? null },
    });
    res.json(payload);
  } catch (error) {
    console.error("[conversations] remove tag error:", error);
    res.status(500).json({ error: "Failed to remove tag" });
  }
}
