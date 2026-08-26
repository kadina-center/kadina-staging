import type { Request, Response } from "express";
import path from "path";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import {
  fromMediaServeToken,
  verifyMediaSignature,
} from "../services/media-access.service";
import { getMediaStorageProvider } from "../services/media";
import {
  readMediaBuffer,
  resolveMediaAbsolutePath,
} from "../services/media-storage.service";

/**
 * Serves a media file only when the request carries a valid HMAC signature.
 * Local files are streamed from disk; remote providers redirect to a short-lived
 * signed URL or fall back to buffering through the API.
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

  const publicPath = fromMediaServeToken(filename);
  const storage = getMediaStorageProvider();

  logAuditFromRequest(req, {
    action: AuditAction.DOWNLOAD,
    entityType: AuditEntity.MEDIA,
    entityId: filename,
    metadata: { filename, driver: storage.name },
  });

  const absolute = resolveMediaAbsolutePath(publicPath);
  if (absolute) {
    res.sendFile(absolute);
    return;
  }

  // Remote / s3: prefer short-lived signed URL (never make private buckets public).
  if (publicPath.startsWith("s3:") && storage.getSignedReadUrl) {
    try {
      const signed = await storage.getSignedReadUrl(publicPath, 300);
      if (signed && /^https?:\/\//i.test(signed)) {
        res.redirect(302, signed);
        return;
      }
    } catch {
      // fall through to buffered response
    }
  }

  const buffer = await readMediaBuffer(publicPath);
  if (!buffer) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(buffer);
}
