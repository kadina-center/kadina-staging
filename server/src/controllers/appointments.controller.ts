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
  isAdmin,
} from "../services/conversation-access.service";
import {
  TimelineEventType,
  actorFromUser,
  logTimeline,
} from "../services/timeline.service";
import { parseCursor, parseLimit } from "../utils/pagination";

const VALID_STATUSES = ["scheduled", "completed", "cancelled", "no_show"];

export async function listAppointments(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { contactId, agentId, status, from, to, cursor, limit } = req.query;

    const where: Prisma.AppointmentWhereInput = {};
    if (typeof contactId === "string" && contactId) where.contactId = contactId;
    if (typeof agentId === "string" && agentId) where.agentId = agentId;
    if (typeof status === "string" && status) where.status = status;

    if (!isAdmin(req.user)) {
      where.contact = contactVisibilityWhereForUser(req.user);
    }

    const scheduledAt: Prisma.DateTimeFilter = {};
    if (typeof from === "string" && from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) scheduledAt.gte = d;
    }
    if (typeof to === "string" && to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) scheduledAt.lte = d;
    }
    if (Object.keys(scheduledAt).length > 0) where.scheduledAt = scheduledAt;

    const include = {
      contact: {
        select: { id: true, name: true, phone: true, channel: true },
      },
      agent: { select: { id: true, name: true, email: true } },
    };

    const take = parseLimit(limit, 50);

    if (take === undefined) {
      const appointments = await prisma.appointment.findMany({
        where,
        orderBy: { scheduledAt: "asc" },
        include,
      });
      res.json(appointments);
      return;
    }

    const cursorId = parseCursor(cursor);
    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      include,
      take: take + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const hasMore = appointments.length > take;
    const page = hasMore ? appointments.slice(0, take) : appointments;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    res.json({ items: page, nextCursor });
  } catch (error) {
    console.error("[appointments] list error:", error);
    res.status(500).json({ error: "Failed to list appointments" });
  }
}

export async function getAppointment(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    // Authorize before loading PII (phone / notes)
    const stub = await prisma.appointment.findUnique({
      where: { id },
      select: { id: true, contactId: true },
    });
    if (!stub) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }
    if (!(await assertCanAccessContact(req, res, stub.contactId))) return;

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        contact: { select: { id: true, name: true, phone: true, channel: true } },
        agent: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(appointment);
  } catch (error) {
    console.error("[appointments] get error:", error);
    res.status(500).json({ error: "Failed to get appointment" });
  }
}

export async function createAppointment(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { contactId, agentId, title, notes, scheduledAt, durationMinutes } =
      req.body as {
        contactId?: string;
        agentId?: string | null;
        title?: string;
        notes?: string | null;
        scheduledAt?: string;
        durationMinutes?: number;
      };

    if (!contactId || !title?.trim() || !scheduledAt) {
      res.status(400).json({
        error: "contactId, title, and scheduledAt are required",
      });
      return;
    }

    if (!(await assertCanAccessContact(req, res, contactId))) return;

    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      res.status(400).json({ error: "scheduledAt must be a valid date" });
      return;
    }

    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (agentId) {
      const agent = await prisma.user.findUnique({ where: { id: agentId } });
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
    }

    const appointment = await prisma.appointment.create({
      data: {
        contactId,
        agentId: agentId ?? null,
        title: title.trim(),
        notes: notes ?? null,
        scheduledAt: scheduledDate,
        durationMinutes:
          typeof durationMinutes === "number" && durationMinutes > 0
            ? Math.floor(durationMinutes)
            : 30,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, channel: true } },
        agent: { select: { id: true, name: true, email: true } },
      },
    });

    if (
      !contact.lastAppointmentAt ||
      scheduledDate.getTime() > contact.lastAppointmentAt.getTime()
    ) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { lastAppointmentAt: scheduledDate },
      });
    }

    logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.APPOINTMENT,
      entityId: appointment.id,
      newValues: {
        title: appointment.title,
        scheduledAt: scheduledDate,
        status: appointment.status,
      },
      metadata: {
        appointmentId: appointment.id,
        contactId,
        scheduledAt: scheduledDate.toISOString(),
      },
    });

    void logTimeline({
      contactId,
      eventType: TimelineEventType.APPOINTMENT_CREATED,
      title: "إنشاء موعد",
      description: appointment.title,
      actor: actorFromUser(req.user),
      metadata: {
        appointmentId: appointment.id,
        scheduledAt: scheduledDate.toISOString(),
      },
    });

    res.status(201).json(appointment);
  } catch (error) {
    console.error("[appointments] create error:", error);
    res.status(500).json({ error: "Failed to create appointment" });
  }
}

export async function updateAppointment(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const body = req.body as {
      title?: string;
      notes?: string | null;
      scheduledAt?: string;
      durationMinutes?: number;
      agentId?: string | null;
      status?: string;
    };

    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, existing.contactId))) return;

    const data: Prisma.AppointmentUpdateInput = {};

    if (body.title !== undefined) {
      if (!body.title.trim()) {
        res.status(400).json({ error: "title cannot be empty" });
        return;
      }
      data.title = body.title.trim();
    }
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.scheduledAt !== undefined) {
      const d = new Date(body.scheduledAt);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "scheduledAt must be a valid date" });
        return;
      }
      data.scheduledAt = d;
    }
    if (typeof body.durationMinutes === "number" && body.durationMinutes > 0) {
      data.durationMinutes = Math.floor(body.durationMinutes);
    }
    if (body.agentId !== undefined) {
      data.agent = body.agentId
        ? { connect: { id: body.agentId } }
        : { disconnect: true };
    }
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        res.status(400).json({
          error: `status must be one of: ${VALID_STATUSES.join(", ")}`,
        });
        return;
      }
      data.status = body.status;
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data,
      include: {
        contact: { select: { id: true, name: true, phone: true, channel: true } },
        agent: { select: { id: true, name: true, email: true } },
      },
    });

    // Completing an appointment bumps CRM visit stats on the contact.
    if (body.status === "completed" && existing.status !== "completed") {
      await prisma.contact.update({
        where: { id: appointment.contactId },
        data: {
          visitCount: { increment: 1 },
          ...(appointment.agentId ? { lastAgentId: appointment.agentId } : {}),
        },
      });
    }

    logAuditFromRequest(req, {
      action:
        body.status === "cancelled" && existing.status !== "cancelled"
          ? AuditAction.STOP
          : AuditAction.UPDATE,
      entityType: AuditEntity.APPOINTMENT,
      entityId: id,
      oldValues: {
        title: existing.title,
        status: existing.status,
        scheduledAt: existing.scheduledAt,
        notes: existing.notes,
      },
      newValues: {
        title: appointment.title,
        status: appointment.status,
        scheduledAt: appointment.scheduledAt,
        notes: appointment.notes,
      },
      metadata: {
        appointmentId: appointment.id,
        contactId: appointment.contactId,
      },
    });

    const cancelled =
      body.status === "cancelled" && existing.status !== "cancelled";
    void logTimeline({
      contactId: appointment.contactId,
      eventType: cancelled
        ? TimelineEventType.APPOINTMENT_CANCELLED
        : TimelineEventType.APPOINTMENT_UPDATED,
      title: cancelled ? "إلغاء موعد" : "تحديث موعد",
      description: appointment.title,
      actor: actorFromUser(req.user),
      metadata: {
        appointmentId: appointment.id,
        oldStatus: existing.status,
        newStatus: appointment.status,
      },
    });

    res.json(appointment);
  } catch (error) {
    console.error("[appointments] update error:", error);
    res.status(500).json({ error: "Failed to update appointment" });
  }
}

export async function deleteAppointment(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Appointment not found" });
      return;
    }

    if (!(await assertCanAccessContact(req, res, existing.contactId))) return;

    await prisma.appointment.delete({ where: { id } });

    logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.APPOINTMENT,
      entityId: id,
      oldValues: {
        title: existing.title,
        status: existing.status,
        scheduledAt: existing.scheduledAt,
      },
      metadata: {
        appointmentId: id,
        contactId: existing.contactId,
      },
    });

    void logTimeline({
      contactId: existing.contactId,
      eventType: TimelineEventType.APPOINTMENT_CANCELLED,
      title: "إلغاء موعد",
      description: existing.title,
      actor: actorFromUser(req.user),
      metadata: { appointmentId: existing.id, deleted: true },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[appointments] delete error:", error);
    res.status(500).json({ error: "Failed to delete appointment" });
  }
}
