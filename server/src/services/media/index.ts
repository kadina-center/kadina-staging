import path from "path";
import { env, isSecretConfigured } from "../../config/env";
import { LocalMediaStorageProvider } from "./local-media-storage.provider";
import { S3CompatibleMediaStorageProvider } from "./s3-compatible-media-storage.provider";
import type { MediaStorageProvider } from "./media-storage.types";

let cached: MediaStorageProvider | null = null;

function s3CredentialsComplete(): boolean {
  return (
    Boolean(env.S3_BUCKET) &&
    isSecretConfigured(env.S3_ACCESS_KEY_ID) &&
    isSecretConfigured(env.S3_SECRET_ACCESS_KEY)
  );
}

function createS3Provider(): MediaStorageProvider {
  return new S3CompatibleMediaStorageProvider({
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL || undefined,
    keyPrefix: env.S3_KEY_PREFIX,
  });
}

function createLocalProvider(): MediaStorageProvider {
  return new LocalMediaStorageProvider(env.MEDIA_STORAGE_PATH);
}

/**
 * Resolve storage driver from ENV.
 * - local: always filesystem
 * - s3: S3-compatible when credentials complete; otherwise warn + local
 * - auto (default): S3 when credentials complete, else local
 *
 * Missing S3 ENV never crashes boot.
 */
export function createMediaStorageProvider(): MediaStorageProvider {
  const driver = (env.MEDIA_STORAGE_DRIVER || "auto").toLowerCase();

  if (driver === "local") {
    return createLocalProvider();
  }

  if (driver === "s3") {
    if (!s3CredentialsComplete()) {
      console.warn(
        "[media] MEDIA_STORAGE_DRIVER=s3 but S3_BUCKET / keys are missing or placeholders; using local storage"
      );
      return createLocalProvider();
    }
    console.log(
      `[media] Using S3-compatible storage bucket=${env.S3_BUCKET} endpoint=${env.S3_ENDPOINT || "(aws default)"}`
    );
    return createS3Provider();
  }

  // auto
  if (s3CredentialsComplete()) {
    console.log(
      `[media] Auto-selected S3-compatible storage bucket=${env.S3_BUCKET}`
    );
    return createS3Provider();
  }
  return createLocalProvider();
}

export function getMediaStorageProvider(): MediaStorageProvider {
  if (!cached) {
    cached = createMediaStorageProvider();
  }
  return cached;
}

/** Test helper — clears singleton so ENV can be re-evaluated. */
export function resetMediaStorageProvider(
  provider?: MediaStorageProvider | null
): void {
  cached = provider === undefined ? null : provider;
}

export function mediaStorageRootHint(): string {
  const p = getMediaStorageProvider();
  if (p.name === "local") {
    return path.resolve(env.MEDIA_STORAGE_PATH);
  }
  return `s3://${env.S3_BUCKET}`;
}
