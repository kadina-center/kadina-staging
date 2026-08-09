import type { Request } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../middleware/auth";
import { emitAuditEvent } from "./socket.service";

export type AuditActorType =
  | "ADMIN"
  | "AGENT"
  | "SYSTEM"
  | "BOT"
  | "AI"
  | "AUTOMATION";

export type AuditStatus = "SUCCESS" | "FAILED" | "WARNING";

export const AuditAction = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  SEND: "SEND",
  RETRY: "RETRY",
  IMPORT: "IMPORT",
  EXPORT: "EXPORT",
  LOCK: "LOCK",
  UNLOCK: "UNLOCK",
  TAKEOVER: "TAKEOVER",
  TRANSFER: "TRANSFER",
  ASSIGN: "ASSIGN",
  ARCHIVE: "ARCHIVE",
  UNARCHIVE: "UNARCHIVE",
  PIN: "PIN",
  UNPIN: "UNPIN",
  READ: "READ",
  UPLOAD: "UPLOAD",
  DOWNLOAD: "DOWNLOAD",
  START: "START",
  STOP: "STOP",
  ENABLE: "ENABLE",
  DISABLE: "DISABLE",
} as const;

export const AuditEntity = {
  USER: "USER",
  CONTACT: "CONTACT",
  CONVERSATION: "CONVERSATION",
  MESSAGE: "MESSAGE",
  NOTE: "NOTE",
  TAG: "TAG",
  CRM: "CRM",
  CAMPAIGN: "CAMPAIGN",
  FLOW: "FLOW",
  SETTINGS: "SETTINGS",
  APPOINTMENT: "APPOINTMENT",
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  MEDIA: "MEDIA",
  SYSTEM: "SYSTEM",
} as const;

export type LogAuditInput = {
  actorId?: string | null;
  performedByName?: string | null;
  performedByRole?: string | null;
  actorType?: AuditActorType | string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  status?: AuditStatus | string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
  /** @deprecated use metadata */
  meta?: unknown;
};

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function actorTypeFromRole(role?: string | null): AuditActorType {
  if (role === "admin") return "ADMIN";
  if (role === "agent") return "AGENT";
  return "SYSTEM";
}

/** Normalize legacy dotted actions like user.login → LOGIN */
export function normalizeAuditAction(action: string): string {
  const a = action.trim();
  const upper = a.toUpperCase();
  if (Object.values(AuditAction).includes(upper as never)) return upper;
  const map: Record<string, string> = {
    "user.login": AuditAction.LOGIN,
    "user.logout": AuditAction.LOGOUT,
    "user.created": AuditAction.CREATE,
    "message.sent": AuditAction.SEND,
    "message.retried": AuditAction.RETRY,
    "message.deleted": AuditAction.DELETE,
    "message.updated": AuditAction.UPDATE,
    "settings.clinic_updated": AuditAction.UPDATE,
    "settings.whatsapp_updated": AuditAction.UPDATE,
    "campaign.sent": AuditAction.START,
    "campaign.cancelled": AuditAction.STOP,
    "campaign.deleted": AuditAction.DELETE,
  };
  if (map[a]) return map[a];
  if (a.includes("login")) return AuditAction.LOGIN;
  if (a.includes("logout")) return AuditAction.LOGOUT;
  if (a.includes("create")) return AuditAction.CREATE;
  if (a.includes("delete")) return AuditAction.DELETE;
  if (a.includes("update") || a.includes("edit")) return AuditAction.UPDATE;
  if (a.includes("send")) return AuditAction.SEND;
  if (a.includes("retry")) return AuditAction.RETRY;
  if (a.includes("lock") && !a.includes("unlock")) return AuditAction.LOCK;
  if (a.includes("unlock")) return AuditAction.UNLOCK;
  if (a.includes("takeover") || a.includes("take_over")) return AuditAction.TAKEOVER;
  if (a.includes("transfer")) return AuditAction.TRANSFER;
  if (a.includes("assign")) return AuditAction.ASSIGN;
  return upper;
}

export function normalizeEntityType(entityType: string): string {
  const e = entityType.trim();
  const upper = e.toUpperCase();
  if (Object.values(AuditEntity).includes(upper as never)) return upper;
  const map: Record<string, string> = {
    User: AuditEntity.USER,
    Contact: AuditEntity.CONTACT,
    Conversation: AuditEntity.CONVERSATION,
    Message: AuditEntity.MESSAGE,
    Note: AuditEntity.NOTE,
    Tag: AuditEntity.TAG,
    Campaign: AuditEntity.CAMPAIGN,
    Flow: AuditEntity.FLOW,
    ClinicSettings: AuditEntity.SETTINGS,
    Appointment: AuditEntity.APPOINTMENT,
  };
  return map[e] || upper;
}

export function requestAuditContext(req?: Request | null): {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  user?: AuthUser | null;
} {
  if (!req) {
    return { ipAddress: null, userAgent: null, requestId: null, user: null };
  }
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    null;
  return {
    ipAddress: ip,
    userAgent: req.header("user-agent") || null,
    requestId: (req as Request & { requestId?: string }).requestId || null,
    user: req.user,
  };
}

/**
 * Fire-and-forget audit writer. Never throws to callers.
 * Emits `audit_event` over Socket.IO for Audit Center realtime.
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    let performedByName = input.performedByName ?? null;
    let performedByRole = input.performedByRole ?? null;
    let actorType =
      (input.actorType as AuditActorType | null | undefined) ?? null;

    if (input.actorId && (!performedByName || !performedByRole || !actorType)) {
      const user = await prisma.user.findUnique({
        where: { id: input.actorId },
        select: { name: true, role: true },
      });
      if (user) {
        performedByName = performedByName || user.name;
        performedByRole = performedByRole || user.role;
        actorType = actorType || actorTypeFromRole(user.role);
      }
    }

    if (!actorType) actorType = "SYSTEM";

    const action = normalizeAuditAction(input.action);
    const entityType = normalizeEntityType(input.entityType);
    const status = (input.status || "SUCCESS").toUpperCase();
    const metadata = input.metadata ?? input.meta ?? null;

    const row = await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        performedByName,
        performedByRole,
        actorType,
        action,
        entityType,
        entityId: input.entityId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
        status,
        oldValues: jsonOrNull(input.oldValues),
        newValues: jsonOrNull(input.newValues),
        metadata: jsonOrNull(metadata),
        // Keep legacy meta populated for older consumers
        meta: jsonOrNull(metadata),
      },
    });

    emitAuditEvent({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      performedByUserId: row.actorId,
      performedByName: row.performedByName,
      performedByRole: row.performedByRole,
      actorType: row.actorType,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      status: row.status,
      oldValues: input.oldValues ?? null,
      newValues: input.newValues ?? null,
      metadata,
      createdAt: row.createdAt,
    });
  } catch (error) {
    console.error("[audit] Failed to write audit log:", error);
  }
}

/** Convenience: fill actor + IP/UA/requestId from Express request */
export function logAuditFromRequest(
  req: Request | null | undefined,
  input: Omit<
    LogAuditInput,
    "ipAddress" | "userAgent" | "requestId" | "actorId" | "performedByName" | "performedByRole" | "actorType"
  > & {
    actorId?: string | null;
    performedByName?: string | null;
    performedByRole?: string | null;
    actorType?: AuditActorType | string | null;
  }
): void {
  const ctx = requestAuditContext(req);
  const user = ctx.user;
  void logAudit({
    ...input,
    actorId: input.actorId ?? user?.id ?? null,
    performedByName: input.performedByName ?? user?.name ?? null,
    performedByRole: input.performedByRole ?? user?.role ?? null,
    actorType:
      input.actorType ??
      (user ? actorTypeFromRole(user.role) : "SYSTEM"),
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  });
}

export type ListAuditQuery = {
  cursor?: string | null;
  limit?: number;
  search?: string | null;
  action?: string | null;
  entityType?: string | null;
  userId?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
};

export async function listAuditLogs(query: ListAuditQuery) {
  const take = Math.min(Math.max(query.limit ?? 40, 1), 100);
  const where: Record<string, unknown> = {};

  if (query.action?.trim()) {
    where.action = normalizeAuditAction(query.action.trim());
  }
  if (query.entityType?.trim()) {
    where.entityType = normalizeEntityType(query.entityType.trim());
  }
  if (query.userId?.trim()) {
    where.actorId = query.userId.trim();
  }
  if (query.status?.trim()) {
    where.status = query.status.trim().toUpperCase();
  }
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  const search = query.search?.trim();
  if (search) {
    const contacts = await prisma.contact.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
        ],
      },
      select: { id: true },
      take: 100,
    });
    const contactIds = contacts.map((c) => c.id);

    where.OR = [
      { performedByName: { contains: search, mode: "insensitive" } },
      { action: { contains: search, mode: "insensitive" } },
      { entityType: { contains: search, mode: "insensitive" } },
      { entityId: { contains: search, mode: "insensitive" } },
      { requestId: { contains: search, mode: "insensitive" } },
      { metadata: { contains: search, mode: "insensitive" } },
      { meta: { contains: search, mode: "insensitive" } },
      ...(contactIds.length
        ? [
            {
              entityType: { in: ["CONTACT", "CRM"] },
              entityId: { in: contactIds },
            },
            {
              // message/note metadata often embeds contactId
              metadata: {
                contains: contactIds[0],
              },
            },
          ]
        : []),
    ];
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(query.cursor
      ? { cursor: { id: query.cursor }, skip: 1 }
      : {}),
  });

  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;

  return {
    items: items.map(mapAuditRow),
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function mapAuditRow(row: {
  id: string;
  actorId: string | null;
  performedByName: string | null;
  performedByRole: string | null;
  actorType: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  status: string;
  oldValues: string | null;
  newValues: string | null;
  metadata: string | null;
  meta: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    performedByUserId: row.actorId,
    performedByName: row.performedByName,
    performedByRole: row.performedByRole,
    actorType: row.actorType,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    status: row.status,
    oldValues: parseJson(row.oldValues),
    newValues: parseJson(row.newValues),
    metadata: parseJson(row.metadata) ?? parseJson(row.meta),
    createdAt: row.createdAt,
  };
}

export async function getAuditStats() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [totalToday, errors, warnings, logins, messagesSent] =
    await Promise.all([
      prisma.auditLog.count({ where: { createdAt: { gte: start } } }),
      prisma.auditLog.count({
        where: { createdAt: { gte: start }, status: "FAILED" },
      }),
      prisma.auditLog.count({
        where: { createdAt: { gte: start }, status: "WARNING" },
      }),
      prisma.auditLog.count({
        where: { createdAt: { gte: start }, action: "LOGIN" },
      }),
      prisma.auditLog.count({
        where: {
          createdAt: { gte: start },
          action: "SEND",
          entityType: "MESSAGE",
        },
      }),
    ]);

  return { totalToday, errors, warnings, logins, messagesSent };
}

export function ensureRequestId(req: Request): string {
  const existing = (req as Request & { requestId?: string }).requestId;
  if (existing) return existing;
  const id = req.header("x-request-id") || randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  return id;
}
