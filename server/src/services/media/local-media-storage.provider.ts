import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { MediaPutResult, MediaStorageProvider } from "./media-storage.types";

function extensionFromMime(mimeType: string): string {
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

function toFilename(publicPathOrKey: string): string {
  const raw = publicPathOrKey.replace(/^\/uploads\//, "");
  return path.basename(raw);
}

export class LocalMediaStorageProvider implements MediaStorageProvider {
  readonly name = "local" as const;

  constructor(private readonly rootDir: string) {
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  async put(
    buffer: Buffer,
    mimeType: string,
    _originalName?: string
  ): Promise<MediaPutResult> {
    const filename = `${Date.now()}-${randomUUID()}${extensionFromMime(mimeType)}`;
    const absolutePath = path.join(this.rootDir, filename);
    await fs.promises.writeFile(absolutePath, buffer);
    return {
      key: filename,
      publicPath: `/uploads/${filename}`,
      filename,
      absolutePath,
    };
  }

  async getBuffer(publicPathOrKey: string): Promise<Buffer | null> {
    const absolute = this.resolveLocalAbsolute(publicPathOrKey);
    if (!absolute || !fs.existsSync(absolute)) return null;
    return fs.promises.readFile(absolute);
  }

  async exists(publicPathOrKey: string): Promise<boolean> {
    const absolute = this.resolveLocalAbsolute(publicPathOrKey);
    return Boolean(absolute && fs.existsSync(absolute));
  }

  async delete(publicPathOrKey: string): Promise<void> {
    const absolute = this.resolveLocalAbsolute(publicPathOrKey);
    if (absolute && fs.existsSync(absolute)) {
      await fs.promises.unlink(absolute);
    }
  }

  resolveLocalAbsolute(publicPathOrKey: string): string | null {
    const filename = toFilename(publicPathOrKey);
    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return null;
    }
    const absolute = path.resolve(this.rootDir, filename);
    const root = path.resolve(this.rootDir);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (absolute !== root && !absolute.startsWith(rootWithSep)) return null;
    return absolute;
  }
}
