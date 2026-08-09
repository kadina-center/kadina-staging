import type { Request, Response } from "express";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import {
  exportConversationsCsv,
  getAnalyticsOverview,
  getCampaignPerformanceStats,
} from "../services/analytics.service";

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function getOverview(req: Request, res: Response): Promise<void> {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const overview = await getAnalyticsOverview(from, to);
    res.json(overview);
  } catch (error) {
    console.error("[analytics] overview error:", error);
    res.status(500).json({ error: "Failed to load analytics overview" });
  }
}

export async function getCampaignAnalytics(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const stats = await getCampaignPerformanceStats(req.params.id);
    if (!stats[0]) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(stats[0]);
  } catch (error) {
    console.error("[analytics] campaign error:", error);
    res.status(500).json({ error: "Failed to load campaign analytics" });
  }
}

export async function exportAnalytics(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Ignore any agent-style wideners — route is admin-only.
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const csv = await exportConversationsCsv(from, to);
    logAuditFromRequest(req, {
      action: AuditAction.EXPORT,
      entityType: AuditEntity.CONVERSATION,
      status: "SUCCESS",
      metadata: {
        kind: "analytics_csv_export",
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        // no phone numbers in audit
      },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="conversations-export.csv"`
    );
    res.send("\uFEFF" + csv);
  } catch (error) {
    console.error("[analytics] export error:", error);
    logAuditFromRequest(req, {
      action: AuditAction.EXPORT,
      entityType: AuditEntity.CONVERSATION,
      status: "FAILED",
      metadata: { kind: "analytics_csv_export" },
    });
    res.status(500).json({ error: "Failed to export analytics" });
  }
}
