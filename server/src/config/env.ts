import dotenv from "dotenv";
import path from "path";

dotenv.config();

const PLACEHOLDER = "REPLACE_ME";
const DEFAULT_JWT = "kadina-dev-secret-change-me";

function readEnv(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

export const env = {
  PORT: Number(readEnv("PORT", "4000")) || 4000,
  DATABASE_URL: readEnv("DATABASE_URL"),
  WHATSAPP_ACCESS_TOKEN: readEnv("WHATSAPP_ACCESS_TOKEN", PLACEHOLDER),
  WHATSAPP_PHONE_NUMBER_ID: readEnv("WHATSAPP_PHONE_NUMBER_ID", PLACEHOLDER),
  WHATSAPP_BUSINESS_ACCOUNT_ID: readEnv(
    "WHATSAPP_BUSINESS_ACCOUNT_ID",
    PLACEHOLDER
  ),
  WHATSAPP_VERIFY_TOKEN: readEnv("WHATSAPP_VERIFY_TOKEN", PLACEHOLDER),
  /**
   * Meta App Secret for X-Hub-Signature-256. Required in production.
   * In development, signature checks run when set; otherwise require
   * ALLOW_INSECURE_WEBHOOK=true to start without it.
   */
  WHATSAPP_APP_SECRET: readEnv("WHATSAPP_APP_SECRET", ""),
  ALLOW_INSECURE_WEBHOOK:
    readEnv("ALLOW_INSECURE_WEBHOOK", "false").toLowerCase() === "true",
  CLIENT_ORIGIN: readEnv("CLIENT_ORIGIN", "http://localhost:5173"),
  MEDIA_STORAGE_PATH: path.resolve(
    process.cwd(),
    readEnv("MEDIA_STORAGE_PATH", "./uploads")
  ),
  /**
   * Media backend: auto | local | s3
   * auto = S3 when bucket+keys are real; otherwise local. Never required.
   */
  MEDIA_STORAGE_DRIVER: readEnv("MEDIA_STORAGE_DRIVER", "auto"),
  S3_ENDPOINT: readEnv("S3_ENDPOINT", ""),
  S3_REGION: readEnv("S3_REGION", "us-east-1"),
  S3_BUCKET: readEnv("S3_BUCKET", ""),
  S3_ACCESS_KEY_ID: readEnv("S3_ACCESS_KEY_ID", ""),
  S3_SECRET_ACCESS_KEY: readEnv("S3_SECRET_ACCESS_KEY", ""),
  S3_FORCE_PATH_STYLE:
    readEnv("S3_FORCE_PATH_STYLE", "true").toLowerCase() !== "false",
  /** Optional CDN/public base for objects (otherwise private + signed proxy). */
  S3_PUBLIC_BASE_URL: readEnv("S3_PUBLIC_BASE_URL", ""),
  S3_KEY_PREFIX: readEnv("S3_KEY_PREFIX", "media/"),
  PUBLIC_BASE_URL: readEnv("PUBLIC_BASE_URL", "http://localhost:4000"),
  BROADCAST_BATCH_SIZE: Number(readEnv("BROADCAST_BATCH_SIZE", "20")) || 20,
  BROADCAST_BATCH_DELAY_MS:
    Number(readEnv("BROADCAST_BATCH_DELAY_MS", "5000")) || 5000,
  /** Hours after campaign send during which an inbound message counts as a reply. */
  CAMPAIGN_REPLY_WINDOW_HOURS:
    Number(readEnv("CAMPAIGN_REPLY_WINDOW_HOURS", "24")) || 24,
  ANTHROPIC_API_KEY: readEnv("ANTHROPIC_API_KEY", PLACEHOLDER),
  ANTHROPIC_MODEL: readEnv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
  EMBEDDING_PROVIDER: readEnv("EMBEDDING_PROVIDER", "local"),
  OPENAI_API_KEY: readEnv("OPENAI_API_KEY", ""),
  INSTAGRAM_ACCESS_TOKEN: readEnv("INSTAGRAM_ACCESS_TOKEN", PLACEHOLDER),
  INSTAGRAM_PAGE_ID: readEnv("INSTAGRAM_PAGE_ID", PLACEHOLDER),
  MESSENGER_ACCESS_TOKEN: readEnv("MESSENGER_ACCESS_TOKEN", PLACEHOLDER),
  MESSENGER_PAGE_ID: readEnv("MESSENGER_PAGE_ID", PLACEHOLDER),
  JWT_SECRET: readEnv("JWT_SECRET", DEFAULT_JWT),
  DEFAULT_ADMIN_EMAIL: readEnv("DEFAULT_ADMIN_EMAIL", "admin@kadina.local"),
  DEFAULT_ADMIN_PASSWORD: readEnv("DEFAULT_ADMIN_PASSWORD", "admin123"),
  NODE_ENV: readEnv("NODE_ENV", "development"),
};

export function isSecretConfigured(value: string): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v === PLACEHOLDER) return false;
  if (v.startsWith("REPLACE_")) return false;
  if (v.startsWith("CHANGE_ME")) return false;
  if (v.startsWith("YOUR_")) return false;
  return true;
}

export const isProduction = env.NODE_ENV === "production";

if (!env.DATABASE_URL || env.DATABASE_URL.includes("user:password")) {
  const msg =
    "[env] DATABASE_URL is missing or still a placeholder. Update it before running.";
  if (isProduction) throw new Error(msg);
  console.warn(msg);
}

if (
  !env.JWT_SECRET ||
  env.JWT_SECRET === DEFAULT_JWT ||
  env.JWT_SECRET.length < 16 ||
  !isSecretConfigured(env.JWT_SECRET)
) {
  const msg =
    "[env] JWT_SECRET is weak or using the development default. Set a long random value.";
  if (isProduction) {
    throw new Error(
      "Refusing to start: JWT_SECRET must be a strong non-default value in production."
    );
  }
  console.warn(msg);
}

if (!isSecretConfigured(env.WHATSAPP_APP_SECRET)) {
  if (isProduction) {
    throw new Error(
      "Refusing to start: WHATSAPP_APP_SECRET is required in production for X-Hub-Signature-256 verification."
    );
  }
  console.warn(
    "[env] WHATSAPP_APP_SECRET is not set — webhook signature verification is DISABLED in development. " +
      "Set WHATSAPP_APP_SECRET before production (production boot will refuse without it)."
  );
}

if (
  isProduction &&
  (env.DEFAULT_ADMIN_PASSWORD === "admin123" ||
    !isSecretConfigured(env.DEFAULT_ADMIN_PASSWORD))
) {
  throw new Error(
    "Refusing to start: DEFAULT_ADMIN_PASSWORD must be a strong non-placeholder value in production."
  );
}

if (isProduction && env.ALLOW_INSECURE_WEBHOOK) {
  throw new Error(
    "Refusing to start: ALLOW_INSECURE_WEBHOOK cannot be true in production."
  );
}

if (isProduction) {
  const origin = env.CLIENT_ORIGIN.toLowerCase();
  if (
    !origin ||
    origin === "*" ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1")
  ) {
    throw new Error(
      "Refusing to start: CLIENT_ORIGIN must be the real Staging/Production frontend HTTPS origin (not localhost or *)."
    );
  }
  const publicBase = env.PUBLIC_BASE_URL.toLowerCase();
  if (
    !publicBase.startsWith("https://") ||
    publicBase.includes("localhost") ||
    publicBase.includes("127.0.0.1")
  ) {
    throw new Error(
      "Refusing to start: PUBLIC_BASE_URL must be the public HTTPS backend URL (not localhost)."
    );
  }
}

const sensitiveKeys = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_VERIFY_TOKEN",
] as const;

for (const key of sensitiveKeys) {
  const value = env[key];
  if (!isSecretConfigured(value)) {
    console.warn(
      `[env] Warning: ${key} is still a placeholder. WhatsApp send/receive will fail until configured.`
    );
  }
}
