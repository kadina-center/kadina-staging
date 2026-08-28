import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "agent" | string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type JwtIdPayload = {
  id?: unknown;
};

/**
 * Verify JWT signature/expiry, then load the live User by JWT `id` only.
 * Does not trust role/email/name claims from the token for authorization.
 * Returns null when the token is invalid/expired or the user no longer exists.
 */
export async function resolveAuthUserFromJwt(
  token: string
): Promise<AuthUser | null> {
  let payload: JwtIdPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtIdPayload;
  } catch {
    return null;
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    env.JWT_SECRET,
    { expiresIn: "24h" }
  );
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const user = await resolveAuthUserFromJwt(header.slice(7));
    if (!user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    console.error("[auth] requireAuth error:", error);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role !== "admin") {
    void logAuditFromRequest(req, {
      action: AuditAction.READ,
      entityType: AuditEntity.SYSTEM,
      status: "FAILED",
      metadata: {
        kind: "admin_required",
        path: req.originalUrl || req.path,
        method: req.method,
      },
    });
    res.status(403).json({ error: "Admin role required" });
    return;
  }
  next();
}
