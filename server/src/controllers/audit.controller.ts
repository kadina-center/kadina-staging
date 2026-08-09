import type { Request, Response } from "express";
import {
  getAuditStats,
  listAuditLogs,
  mapAuditRow,
  logAuditFromRequest,
  AuditAction,
  AuditEntity,
} from "../services/audit.service";
import { prisma } from "../lib/prisma";
import { parseCursor, parseLimit } from "../utils/pagination";

export async function listAudit(req: Request, res: Response): Promise<void> {
  try {
    const {
      cursor,
      limit,
      search,
      action,
      entityType,
      userId,
      status,
      from,
      to,
    } = req.query;

    const page = await listAuditLogs({
      cursor: parseCursor(cursor),
      limit: parseLimit(limit, 40) ?? 40,
      search: typeof search === "string" ? search : null,
      action: typeof action === "string" ? action : null,
      entityType: typeof entityType === "string" ? entityType : null,
      userId: typeof userId === "string" ? userId : null,
      status: typeof status === "string" ? status : null,
      from: typeof from === "string" ? from : null,
      to: typeof to === "string" ? to : null,
    });

    res.json(page);
  } catch (error) {
    console.error("[audit] list error:", error);
    res.status(500).json({ error: "Failed to load audit logs" });
  }
}

export async function auditStats(req: Request, res: Response): Promise<void> {
  try {
    const stats = await getAuditStats();
    res.json(stats);
  } catch (error) {
    console.error("[audit] stats error:", error);
    res.status(500).json({ error: "Failed to load audit stats" });
  }
}

export async function getAuditEntry(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const row = await prisma.auditLog.findUnique({
      where: { id: req.params.id },
    });
    if (!row) {
      res.status(404).json({ error: "Audit entry not found" });
      return;
    }
    res.json(mapAuditRow(row));
  } catch (error) {
    console.error("[audit] get error:", error);
    res.status(500).json({ error: "Failed to load audit entry" });
  }
}

export async function exportAudit(req: Request, res: Response): Promise<void> {
  try {
    const {
      search,
      action,
      entityType,
      userId,
      status,
      from,
      to,
      format,
    } = req.query;

    const page = await listAuditLogs({
      limit: 1000,
      search: typeof search === "string" ? search : null,
      action: typeof action === "string" ? action : null,
      entityType: typeof entityType === "string" ? entityType : null,
      userId: typeof userId === "string" ? userId : null,
      status: typeof status === "string" ? status : null,
      from: typeof from === "string" ? from : null,
      to: typeof to === "string" ? to : null,
    });

    logAuditFromRequest(req, {
      action: AuditAction.EXPORT,
      entityType: AuditEntity.SYSTEM,
      metadata: {
        format: format === "csv" ? "csv" : "json",
        count: page.items.length,
      },
    });

    if (format === "csv") {
      const header = [
        "id",
        "action",
        "entityType",
        "entityId",
        "performedByName",
        "performedByRole",
        "actorType",
        "status",
        "ipAddress",
        "requestId",
        "createdAt",
      ];
      const lines = [
        header.join(","),
        ...page.items.map((r) =>
          [
            r.id,
            r.action,
            r.entityType,
            r.entityId || "",
            csvEscape(r.performedByName || ""),
            r.performedByRole || "",
            r.actorType || "",
            r.status,
            r.ipAddress || "",
            r.requestId || "",
            new Date(r.createdAt).toISOString(),
          ].join(",")
        ),
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-export.csv"`
      );
      res.send("\uFEFF" + lines.join("\n"));
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-export.json"`
    );
    res.json({ exportedAt: new Date().toISOString(), items: page.items });
  } catch (error) {
    console.error("[audit] export error:", error);
    res.status(500).json({ error: "Failed to export audit logs" });
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
