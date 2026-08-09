import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} as const;

export async function listUsers(_req: Request, res: Response): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: userSelect,
    });
    res.json(users);
  } catch (error) {
    console.error("[users] list error:", error);
    res.status(500).json({ error: "Failed to list users" });
  }
}

export async function createUser(req: Request, res: Response): Promise<void> {
  try {
    const { name, email, role, password } = req.body as {
      name?: string;
      email?: string;
      role?: string;
      password?: string;
    };

    if (!name?.trim() || !email?.trim()) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      res
        .status(400)
        .json({ error: "password is required (min 6 characters)" });
      return;
    }

    const normalizedRole =
      role === "admin" || role === "agent" ? role : "agent";

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: normalizedRole,
        passwordHash,
      },
      select: userSelect,
    });

    logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.USER,
      entityId: user.id,
      newValues: {
        name: user.name,
        email: user.email,
        role: user.role,
      },
      metadata: { email: user.email, role: user.role },
    });

    res.status(201).json(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create user";
    console.error("[users] create error:", message);
    res.status(500).json({ error: message });
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const body = req.body as {
      name?: string;
      email?: string;
      role?: string;
    };

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const data: { name?: string; email?: string; role?: string } = {};
    if (typeof body.name === "string" && body.name.trim()) {
      data.name = body.name.trim();
    }
    if (typeof body.email === "string" && body.email.trim()) {
      data.email = body.email.trim().toLowerCase();
    }
    if (body.role === "admin" || body.role === "agent") {
      data.role = body.role;
    }

    if (
      req.user?.id === id &&
      data.role &&
      data.role !== existing.role
    ) {
      res.status(400).json({ error: "لا يمكن تغيير دور حسابك الحالي" });
      return;
    }

    if (!Object.keys(data).length) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: userSelect,
    });

    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.USER,
      entityId: user.id,
      oldValues: {
        name: existing.name,
        email: existing.email,
        role: existing.role,
      },
      newValues: {
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    res.json(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update user";
    console.error("[users] update error:", message);
    res.status(500).json({ error: message });
  }
}

export async function changeUserPassword(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { password } = req.body as { password?: string };

    if (!password || typeof password !== "string" || password.length < 6) {
      res
        .status(400)
        .json({ error: "password is required (min 6 characters)" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.USER,
      entityId: id,
      metadata: { reason: "password_changed", targetUserId: id },
      newValues: { passwordChanged: true },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[users] password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const actorId = req.user?.id;

    if (!actorId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (actorId === id) {
      res.status(400).json({ error: "لا يمكن حذف حسابك الحالي" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Clear / reassign FK refs so delete works without schema changes.
    await prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { assignedToId: id },
        data: { assignedToId: null, assignedAt: null },
      });
      await tx.conversation.updateMany({
        where: { assignedByUserId: id },
        data: { assignedByUserId: null },
      });
      await tx.conversation.updateMany({
        where: { lockedById: id },
        data: { lockedById: null, lockedAt: null },
      });
      await tx.contact.updateMany({
        where: { lastAgentId: id },
        data: { lastAgentId: null },
      });
      await tx.whatsAppChannel.updateMany({
        where: { assignedUserId: id },
        data: { assignedUserId: null },
      });
      await tx.appointment.updateMany({
        where: { agentId: id },
        data: { agentId: null },
      });
      await tx.message.updateMany({
        where: { createdByUserId: id },
        data: { createdByUserId: null },
      });
      await tx.timelineEvent.updateMany({
        where: { performedByUserId: id },
        data: { performedByUserId: null },
      });
      await tx.auditLog.updateMany({
        where: { actorId: id },
        data: { actorId: null },
      });
      // Notes require an author — keep history under the deleting admin.
      await tx.note.updateMany({
        where: { authorId: id },
        data: { authorId: actorId },
      });
      await tx.loginHistory.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.USER,
      entityId: id,
      oldValues: {
        name: existing.name,
        email: existing.email,
        role: existing.role,
      },
    });

    res.status(204).send();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete user";
    console.error("[users] delete error:", message);
    res.status(500).json({ error: "تعذر حذف الموظف. حاول مرة أخرى." });
  }
}
