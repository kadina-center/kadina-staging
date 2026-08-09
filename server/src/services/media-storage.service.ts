import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../config/env";

function ensureStorageDir(): void {
  if (!fs.existsSync(env.MEDIA_STORAGE_PATH)) {
    fs.mkdirSync(env.MEDIA_STORAGE_PATH, { recursive: true });
  }
}

function extensionFromMime(mimeType: string, _originalName?: string): string {
  // Never trust the client-supplied filename/extension (XSS via .html/.js on /uploads).
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "video/mp4": ".mp4",
    "video/3gpp": ".3gp",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
    "text/plain": ".txt",
  };
  return map[mimeType] || ".bin";
}

/** Saves a buffer locally and returns a public path like `/uploads/filename.ext` */
export function saveMediaBuffer(
  buffer: Buffer,
  mimeType: string,
  originalName?: string
): { absolutePath: string; publicPath: string; filename: string } {
  ensureStorageDir();
  const filename = `${Date.now()}-${randomUUID()}${extensionFromMime(
    mimeType,
    originalName
  )}`;
  const absolutePath = path.join(env.MEDIA_STORAGE_PATH, filename);
  fs.writeFileSync(absolutePath, buffer);
  return {
    absolutePath,
    publicPath: `/uploads/${filename}`,
    filename,
  };
}

export function resolveLocalMediaUrl(publicPath: string): string {
  if (publicPath.startsWith("http://") || publicPath.startsWith("https://")) {
    return publicPath;
  }
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}${publicPath}`;
}
