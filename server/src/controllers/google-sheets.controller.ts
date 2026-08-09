import type { Request, Response } from "express";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import { exportContactsToSheet } from "../services/google-sheets.service";

export async function exportContacts(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { spreadsheetId, accessToken } = req.body as {
      spreadsheetId?: string;
      accessToken?: string;
    };

    if (!spreadsheetId?.trim() || !accessToken?.trim()) {
      res
        .status(400)
        .json({ error: "spreadsheetId and accessToken are required" });
      return;
    }

    // Route is requireAdmin — still audit success for ops trail (no PII / no token)
    const result = await exportContactsToSheet(spreadsheetId, accessToken);
    logAuditFromRequest(req, {
      action: AuditAction.EXPORT,
      entityType: AuditEntity.CONTACT,
      status: "SUCCESS",
      metadata: {
        kind: "google_sheets_export",
        spreadsheetId: spreadsheetId.trim(),
        rowsWritten: result.rowsWritten ?? null,
      },
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google Sheets export failed";
    console.error("[google-sheets] export error:", message);
    logAuditFromRequest(req, {
      action: AuditAction.EXPORT,
      entityType: AuditEntity.CONTACT,
      status: "FAILED",
      metadata: { kind: "google_sheets_export", error: message },
    });
    res.status(500).json({ error: message });
  }
}
