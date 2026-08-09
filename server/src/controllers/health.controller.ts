import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getIO } from "../services/socket.service";
import { getChannelsHealthSnapshot } from "../services/whatsapp-channel.service";

/**
 * Cheap liveness probe — no DB access, safe to hit frequently
 * (load balancers, uptime monitors).
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }

  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    db: dbOk ? "up" : "down",
    timestamp: new Date().toISOString(),
  });
}

function getSocketConnectedCount(): number | null {
  try {
    const io = getIO();
    return io.sockets.sockets.size;
  } catch {
    return null;
  }
}

/**
 * Deeper diagnostic snapshot for admins: DB connectivity, failed message
 * backlog, last inbound activity, socket connections, last audit entry, and
 * whether WhatsApp credentials are configured.
 */
export async function getDetailedHealth(
  _req: Request,
  res: Response
): Promise<void> {
  const startedAt = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }

  const [
    pendingFailedMessages,
    lastInboundMessage,
    lastAuditLog,
    scheduledJobsPending,
    scheduledJobsFailed,
    deadLetterCount,
    recentSystemErrors,
    lastSystemError,
    whatsappChannels,
  ] = await Promise.all([
    prisma.message.count({ where: { status: "failed" } }),
    prisma.message.findFirst({
      where: { direction: "inbound" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, contactId: true },
    }),
    prisma.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, action: true, actorId: true, createdAt: true },
    }),
    prisma.scheduledJob.count({ where: { status: "pending" } }),
    prisma.scheduledJob.count({ where: { status: "failed" } }),
    prisma.deadLetterMessage.count(),
    prisma.systemError.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.systemError.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, source: true, message: true, createdAt: true },
    }),
    getChannelsHealthSnapshot(),
  ]);

  // Discover last backup file from backups/ directory (ops).
  let lastBackup: { name: string; mtime: string } | null = null;
  try {
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.resolve(process.cwd(), "backups");
    if (fs.existsSync(dir)) {
      const files = fs
        .readdirSync(dir)
        .map((name) => {
          const full = path.join(dir, name);
          const st = fs.statSync(full);
          return { name, mtime: st.mtime };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      if (files[0]) {
        lastBackup = {
          name: files[0].name,
          mtime: files[0].mtime.toISOString(),
        };
      }
    }
  } catch {
    lastBackup = null;
  }

  const activeChannels = whatsappChannels.filter((ch) => ch.isActive);
  const connectedActive = activeChannels.filter(
    (ch) => ch.status === "CONNECTED"
  );
  const messagingReady = connectedActive.length > 0;
  const hasActiveUnhealthy = activeChannels.some(
    (ch) => ch.status !== "CONNECTED"
  );

  // Liveness for DB stays in HTTP status; overall readiness is explicit for ops UI.
  let overall: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (!dbOk) overall = "unhealthy";
  else if (!messagingReady || hasActiveUnhealthy) overall = "degraded";

  res.status(dbOk ? 200 : 503).json({
    ok: dbOk && messagingReady,
    overall,
    messagingReady,
    db: dbOk ? "up" : "down",
    checkedInMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
    whatsapp: {
      /** At least one active channel with Meta Test Connection = CONNECTED */
      configured: messagingReady,
      channelCount: whatsappChannels.length,
      activeCount: activeChannels.length,
      connectedCount: connectedActive.length,
    },
    whatsappChannels,
    webhook: {
      lastInboundAt: lastInboundMessage?.createdAt ?? null,
      signatureRequired: true,
    },
    messages: {
      pendingFailed: pendingFailedMessages,
    },
    lastInboundMessage,
    socket: {
      connectedCount: getSocketConnectedCount(),
    },
    lastAuditLog,
    queue: {
      pending: scheduledJobsPending,
      failed: scheduledJobsFailed,
    },
    scheduledJobs: {
      pending: scheduledJobsPending,
      failed: scheduledJobsFailed,
    },
    deadLetterMessages: deadLetterCount,
    systemErrorsLast24h: recentSystemErrors,
    lastError: lastSystemError,
    lastBackup,
    clinicSettings: {
      whatsappConfigured: messagingReady,
    },
  });
}
