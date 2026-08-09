import crypto from "crypto";
import path from "path";
import { env } from "../config/env";

/**
 * Short-lived HMAC signed URLs for media under MEDIA_STORAGE_PATH.
 * Used instead of public /uploads static hosting.
 *
 * URL shape: /media/<filename>?e=<unixExpires>&s=<hexHmac>
 */

function mediaHmac(filename: string, expires: number): string {
  return crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${filename}:${expires}`)
    .digest("hex");
}

export function signMediaFilename(
  filename: string,
  ttlSeconds = 3600
): { url: string; expires: number } {
  const safe = path.basename(filename);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const s = mediaHmac(safe, expires);
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return {
    url: `${base}/media/${encodeURIComponent(safe)}?e=${expires}&s=${s}`,
    expires,
  };
}

/** Convert a stored publicPath like `/uploads/foo.jpg` into a signed URL. */
export function signStoredMediaPath(
  publicPath: string | null | undefined,
  ttlSeconds = 3600
): string | null {
  if (!publicPath) return null;
  if (publicPath.startsWith("http://") || publicPath.startsWith("https://")) {
    return publicPath;
  }
  const filename = path.basename(publicPath);
  return signMediaFilename(filename, ttlSeconds).url;
}

export function verifyMediaSignature(
  filename: string,
  expiresRaw: string | undefined,
  signature: string | undefined
): boolean {
  if (!expiresRaw || !signature) return false;
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires)) return false;
  if (expires < Math.floor(Date.now() / 1000)) return false;

  const safe = path.basename(filename);
  const expected = mediaHmac(safe, expires);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
