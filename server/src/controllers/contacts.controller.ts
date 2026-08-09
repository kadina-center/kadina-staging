import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import {
  assertCanAccessContact,
  contactVisibilityWhereForUser,
} from "../services/conversation-access.service";
import { signStoredMediaPath } from "../services/media-access.service";
import { messageAttributionFields } from "../services/message-attribution.service";
import {
  TimelineEventType,
  actorFromUser,
  logTimeline,
} from "../services/timeline.service";
import { parseCursor, parseLimit } from "../utils/pagination";

export async function listContacts(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const contacts = await prisma.contact.findMany({
      where: contactVisibilityWhereForUser(req.user),
      orderBy: { lastMessageAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const payload = contacts.map((contact) => ({
      id: contact.id,
      phone: contact.phone,
      name: contact.name,
      channel: contact.channel,
      channelUserId: contact.channelUserId,
      lastMessageAt: contact.lastMessageAt,
      createdAt: contact.createdAt,
      lastMessage: contact.messages[0]
        ? {
            id: contact.messages[0].id,
            content: contact.messages[0].content,
            direction: contact.messages[0].direction,
            createdAt: contact.messages[0].createdAt,
            status: contact.messages[0].status,
            ...messageAttributionFields(contact.messages[0]),
          }
        : null,
    }));

    res.json(payload);
  } catch (error) {
    console.error("[contacts] list error:", error);
    res.status(500).json({ error: "Failed to list contacts" });
  }
}

export async function getContactMessages(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessContact(req, res, id))) return;

    const { cursor, limit, includeDeleted } = req.query;

    const where: Prisma.MessageWhereInput = { contactId: id };
    if (!(includeDeleted === "true" || includeDeleted === "1")) {
      where.deletedAt = null;
    }

    const take = parseLimit(limit, 50);

    // Legacy shape: full ascending history when no pagination requested.
    if (take === undefined) {
      const messages = await prisma.message.findMany({
        where,
        orderBy: { createdAt: "asc" },
      });
      res.json(
        messages.map((m) => ({
          ...m,
          mediaUrl: signStoredMediaPath(m.mediaUrl),
          ...messageAttributionFields(m),
        }))
      );
      return;
    }

    const cursorId = parseCursor(cursor);
    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = messages.length > take;
    const page = hasMore ? messages.slice(0, take) : messages;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    res.json({
      items: [...page].reverse().map((m) => ({
        ...m,
        mediaUrl: signStoredMediaPath(m.mediaUrl),
        ...messageAttributionFields(m),
      })),
      nextCursor,
    });
  } catch (error) {
    console.error("[contacts] messages error:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
}

export async function getContactProfile(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessContact(req, res, id))) return;

    const contact = await prisma.contact.findUnique({
      where: { id },
      include: {
        lastAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
        conversation: {
          include: {
            assignedTo: {
              select: { id: true, name: true, email: true, role: true },
            },
            assignedBy: {
              select: { id: true, name: true, email: true, role: true },
            },
            tags: true,
            _count: { select: { notes: true } },
          },
        },
      },
    });

    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const [
      messageCount,
      mediaCount,
      appointmentTotal,
      appointmentScheduled,
      lastMessage,
      lastOutbound,
    ] = await Promise.all([
      prisma.message.count({
        where: { contactId: id, deletedAt: null },
      }),
      prisma.message.count({
        where: {
          contactId: id,
          deletedAt: null,
          mediaUrl: { not: null },
        },
      }),
      prisma.appointment.count({ where: { contactId: id } }),
      prisma.appointment.count({
        where: { contactId: id, status: "scheduled" },
      }),
      prisma.message.findFirst({
        where: { contactId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
      }),
      prisma.message.findFirst({
        where: {
          contactId: id,
          deletedAt: null,
          direction: "outbound",
          // Failed sends must not drive "last replied by" / attribution.
          status: { in: ["sent", "delivered", "read"] },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const conversation = contact.conversation;
    const lastRepliedBy = lastOutbound
      ? {
          userId: lastOutbound.createdByUserId,
          name:
            lastOutbound.createdByName ||
            (lastOutbound.direction === "outbound" ? "System" : null),
          role: lastOutbound.createdByRole,
          senderType: lastOutbound.senderType,
          avatar: lastOutbound.createdByAvatar,
          at: lastOutbound.createdAt,
        }
      : null;

    res.json({
      contact: {
        id: contact.id,
        phone: contact.phone,
        name: contact.name,
        channel: contact.channel,
        channelUserId: contact.channelUserId,
        avatarUrl: contact.avatarUrl,
        crmStatus: contact.crmStatus,
        customNotes: contact.customNotes,
        doctor: contact.doctor,
        treatment: contact.treatment,
        visitCount: contact.visitCount,
        leadSource: contact.leadSource,
        lastAppointmentAt: contact.lastAppointmentAt,
        lastAgentId: contact.lastAgentId,
        lastAgent: contact.lastAgent,
        lastMessageAt: contact.lastMessageAt,
        createdAt: contact.createdAt,
        optedOut: contact.optedOut,
      },
      conversation: conversation
        ? {
            id: conversation.id,
            status: conversation.status,
            assignedToId: conversation.assignedToId,
            assignedTo: conversation.assignedTo,
            assignedAt: conversation.assignedAt,
            assignedByUserId: conversation.assignedByUserId,
            assignedBy: conversation.assignedBy,
            pinned: conversation.pinned,
            archived: conversation.archived,
            unreadCount: conversation.unreadCount,
            lastMessageAt: conversation.lastMessageAt,
            createdAt: conversation.createdAt,
            tags: conversation.tags,
            noteCount: conversation._count.notes,
          }
        : null,
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            content: lastMessage.content,
            direction: lastMessage.direction,
            type: lastMessage.type,
            status: lastMessage.status,
            createdAt: lastMessage.createdAt,
            ...messageAttributionFields(lastMessage),
          }
        : null,
      lastRepliedBy,
      counts: {
        conversations: conversation ? 1 : 0,
        messages: messageCount,
        media: mediaCount,
        appointments: appointmentTotal,
        appointmentsScheduled: appointmentScheduled,
        notes: conversation?._count.notes ?? 0,
        visits: contact.visitCount,
      },
      tags: conversation?.tags ?? [],
    });
  } catch (error) {
    console.error("[contacts] profile error:", error);
    res.status(500).json({ error: "Failed to load contact profile" });
  }
}

export async function getContactMedia(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessContact(req, res, id))) return;

    const take = parseLimit(req.query.limit, 24) ?? 24;
    const cursorId = parseCursor(req.query.cursor);

    const messages = await prisma.message.findMany({
      where: {
        contactId: id,
        deletedAt: null,
        mediaUrl: { not: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = messages.length > take;
    const page = hasMore ? messages.slice(0, take) : messages;

    res.json({
      items: page.map((m) => ({
        id: m.id,
        messageId: m.id,
        type: m.type,
        mediaUrl: signStoredMediaPath(m.mediaUrl),
        mediaMimeType: m.mediaMimeType,
        caption: m.caption,
        content: m.content,
        direction: m.direction,
        createdAt: m.createdAt,
        ...messageAttributionFields(m),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (error) {
    console.error("[contacts] media error:", error);
    res.status(500).json({ error: "Failed to load media" });
  }
}

export async function updateContact(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessContact(req, res, id))) return;

    const body = req.body as {
      name?: string | null;
      crmStatus?: string;
      customNotes?: string | null;
      doctor?: string | null;
      treatment?: string | null;
      leadSource?: string | null;
      visitCount?: number;
      lastAgentId?: string | null;
    };

    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const data: Prisma.ContactUpdateInput = {};

    if (body.name !== undefined) data.name = body.name;
    if (typeof body.crmStatus === "string" && body.crmStatus.trim()) {
      data.crmStatus = body.crmStatus.trim();
    }
    if (body.customNotes !== undefined) data.customNotes = body.customNotes;
    if (body.doctor !== undefined) data.doctor = body.doctor;
    if (body.treatment !== undefined) data.treatment = body.treatment;
    if (body.leadSource !== undefined) data.leadSource = body.leadSource;
    if (typeof body.visitCount === "number" && Number.isFinite(body.visitCount)) {
      data.visitCount = Math.max(0, Math.floor(body.visitCount));
    }
    if (body.lastAgentId !== undefined) {
      data.lastAgent = body.lastAgentId
        ? { connect: { id: body.lastAgentId } }
        : { disconnect: true };
    }

    const contact = await prisma.contact.update({
      where: { id },
      data,
    });

    const crmStatusChanged =
      typeof body.crmStatus === "string" &&
      body.crmStatus.trim() &&
      body.crmStatus.trim() !== existing.crmStatus;

    const changedFields = Object.keys(data);
    if (changedFields.length > 0) {
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      const existingRecord = existing as unknown as Record<string, unknown>;
      const contactRecord = contact as unknown as Record<string, unknown>;
      for (const key of changedFields) {
        oldValues[key] = existingRecord[key];
        newValues[key] = contactRecord[key];
      }

      logAuditFromRequest(req, {
        action: AuditAction.UPDATE,
        entityType: crmStatusChanged ? AuditEntity.CRM : AuditEntity.CONTACT,
        entityId: contact.id,
        oldValues,
        newValues,
        metadata: {
          contactId: contact.id,
          contactName: contact.name,
          contactPhone: contact.phone,
          fields: changedFields,
        },
      });

      void logTimeline({
        contactId: contact.id,
        eventType: crmStatusChanged
          ? TimelineEventType.CRM_UPDATED
          : TimelineEventType.CONTACT_UPDATED,
        title: crmStatusChanged ? "تحديث حالة CRM" : "تحديث جهة الاتصال",
        actor: actorFromUser(req.user),
        metadata: crmStatusChanged
          ? {
              oldCrmStatus: existing.crmStatus,
              newCrmStatus: contact.crmStatus,
              fields: changedFields,
            }
          : { fields: changedFields },
      });
    }

    res.json({
      id: contact.id,
      phone: contact.phone,
      name: contact.name,
      channel: contact.channel,
      channelUserId: contact.channelUserId,
      avatarUrl: contact.avatarUrl,
      crmStatus: contact.crmStatus,
      customNotes: contact.customNotes,
      doctor: contact.doctor,
      treatment: contact.treatment,
      visitCount: contact.visitCount,
      leadSource: contact.leadSource,
      lastAppointmentAt: contact.lastAppointmentAt,
      lastAgentId: contact.lastAgentId,
      lastMessageAt: contact.lastMessageAt,
      createdAt: contact.createdAt,
      lastMessage: null,
    });
  } catch (error) {
    console.error("[contacts] update error:", error);
    res.status(500).json({ error: "Failed to update contact" });
  }
}
