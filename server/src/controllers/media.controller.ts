import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import { verifyMediaSignature } from "../services/media-access.service";

/**
 * Serves a media file only when the request carries a valid HMAC signature
 * (or an authenticated Bearer session via requireAuth on an alternate path).
 */
export async function serveSignedMedia(
  req: Request,
  res: Response
): Promise<void> {
  const filename = path.basename(String(req.params.filename || ""));
  if (!filename || filename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const { e, s } = req.query as { e?: string; s?: string };
  if (!verifyMediaSignature(filename, e, s)) {
    res.status(401).json({ error: "Invalid or expired media signature" });
    return;
  }

  const absolute = path.resolve(env.MEDIA_STORAGE_PATH, filename);
  const root = path.resolve(env.MEDIA_STORAGE_PATH);
  if (!absolute.startsWith(root) || !fs.existsSync(absolute)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  logAuditFromRequest(req, {
    action: AuditAction.DOWNLOAD,
    entityType: AuditEntity.MEDIA,
    entityId: filename,
    metadata: { filename },
  });

  res.sendFile(absolute);
}
