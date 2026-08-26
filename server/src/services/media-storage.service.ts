import { env } from "../config/env";
import { getMediaStorageProvider } from "./media";
import { LocalMediaStorageProvider } from "./media/local-media-storage.provider";
import type { MediaPutResult } from "./media/media-storage.types";

export type { MediaPutResult, MediaStorageProvider } from "./media/media-storage.types";
export {
  getMediaStorageProvider,
  resetMediaStorageProvider,
  createMediaStorageProvider,
} from "./media";

/**
 * Persist media via the active provider (local by default).
 * Returns a publicPath suitable for Message.mediaUrl:
 * - local: `/uploads/<filename>`
 * - s3: `s3:<objectKey>`
 */
export async function saveMediaBuffer(
  buffer: Buffer,
  mimeType: string,
  originalName?: string
): Promise<MediaPutResult> {
  return getMediaStorageProvider().put(buffer, mimeType, originalName);
}

/** Read bytes; falls back to local disk for legacy `/uploads/` paths. */
export async function readMediaBuffer(
  publicPath: string
): Promise<Buffer | null> {
  const provider = getMediaStorageProvider();
  const fromProvider = await provider.getBuffer(publicPath);
  if (fromProvider) return fromProvider;
  if (publicPath.startsWith("/uploads/") && provider.name !== "local") {
    return new LocalMediaStorageProvider(env.MEDIA_STORAGE_PATH).getBuffer(
      publicPath
    );
  }
  return null;
}

/**
 * Absolute path for express sendFile when the object lives on local disk
 * (including legacy uploads after switching driver to S3).
 */
export function resolveMediaAbsolutePath(publicPath: string): string | null {
  const provider = getMediaStorageProvider();
  const fromProvider = provider.resolveLocalAbsolute?.(publicPath) ?? null;
  if (fromProvider) return fromProvider;
  if (publicPath.startsWith("/uploads/") && provider.name !== "local") {
    return new LocalMediaStorageProvider(
      env.MEDIA_STORAGE_PATH
    ).resolveLocalAbsolute(publicPath);
  }
  return null;
}

export function resolveLocalMediaUrl(publicPath: string): string {
  if (publicPath.startsWith("http://") || publicPath.startsWith("https://")) {
    return publicPath;
  }
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}${publicPath}`;
}
