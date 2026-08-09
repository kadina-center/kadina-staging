import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken } from "../middleware/auth";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !user.passwordHash) {
      logAuditFromRequest(req, {
        action: AuditAction.LOGIN,
        entityType: AuditEntity.LOGIN,
        status: "FAILED",
        metadata: { email: email.toLowerCase(), reason: "invalid_credentials" },
      });
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      logAuditFromRequest(req, {
        actorId: user.id,
        performedByName: user.name,
        performedByRole: user.role,
        action: AuditAction.LOGIN,
        entityType: AuditEntity.LOGIN,
        entityId: user.id,
        status: "FAILED",
        metadata: { reason: "invalid_password" },
      });
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const ip = req.ip || req.socket.remoteAddress || null;
    const userAgent = req.header("user-agent") || null;

    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        ip,
        userAgent,
        success: true,
      },
    });
    logAuditFromRequest(req, {
      actorId: user.id,
      performedByName: user.name,
      performedByRole: user.role,
      action: AuditAction.LOGIN,
      entityType: AuditEntity.LOGIN,
      entityId: user.id,
      metadata: { email: user.email },
    });

    res.json({
      token: signToken(authUser),
      user: authUser,
    });
  } catch (error) {
    console.error("[auth] login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (req.user) {
    logAuditFromRequest(req, {
      action: AuditAction.LOGOUT,
      entityType: AuditEntity.LOGOUT,
      entityId: req.user.id,
    });
  }
  res.status(204).send();
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
}
