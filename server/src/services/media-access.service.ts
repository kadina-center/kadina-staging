import crypto from "crypto";
import path from "path";
import { env } from "../config/env";
import { S3_PATH_PREFIX } from "./media/media-storage.types";

/**
 * Short-lived HMAC signed URLs for stored media.
 * Used instead of public /uploads static hosting.
 *
 * URL shape: /media/<token>?e=<unixExpires>&s=<hexHmac>
 * - local `/uploads/foo.jpg` → token = `foo.jpg` (unchanged)
 * - s3 / opaque keys → token = `b64.<base64url(publicPath)>`
 */

function mediaHmac(token: string, expires: number): string {
  return crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${token}:${expires}`)
    .digest("hex");
}

/** Encode a stored mediaUrl into a single path-safe serve token. */
export function toMediaServeToken(publicPath: string): string {
  if (publicPath.startsWith("/uploads/")) {
    return path.basename(publicPath);
  }
  if (
    publicPath.startsWith(S3_PATH_PREFIX) ||
    publicPath.startsWith("http://") ||
    publicPath.startsWith("https://")
  ) {
    return `b64.${Buffer.from(publicPath, "utf8").toString("base64url")}`;
  }
  return path.basename(publicPath);
}

/** Reverse of toMediaServeToken for the signed /media route. */
export function fromMediaServeToken(token: string): string {
  const safe = path.basename(token);
  if (safe.startsWith("b64.")) {
    try {
      return Buffer.from(safe.slice(4), "base64url").toString("utf8");
    } catch {
      return `/uploads/${safe}`;
    }
  }
  return `/uploads/${safe}`;
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

/** Convert a stored publicPath into a signed URL for API clients. */
export function signStoredMediaPath(
  publicPath: string | null | undefined,
  ttlSeconds = 3600
): string | null {
  if (!publicPath) return null;
  if (publicPath.startsWith("http://") || publicPath.startsWith("https://")) {
    return publicPath;
  }
  const token = toMediaServeToken(publicPath);
  return signMediaFilename(token, ttlSeconds).url;
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
