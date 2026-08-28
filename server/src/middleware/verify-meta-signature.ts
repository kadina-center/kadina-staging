import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env, isSecretConfigured } from "../config/env";

declare global {
  namespace Express {
    interface Request {
      /** Raw request body bytes, captured by express.json({ verify }) for HMAC checks. */
      rawBody?: Buffer;
    }
  }
}

export type MetaSignatureCheckResult =
  | { ok: true }
  | { ok: false; reason: "missing_signature" | "missing_raw_body" | "invalid_signature" };

/**
 * Pure Meta X-Hub-Signature-256 check over exact raw bytes.
 * Never reconstructs a body from parsed JSON.
 */
export function checkMetaSignature(opts: {
  appSecret: string;
  signatureHeader: string | undefined;
  rawBody: Buffer | undefined;
}): MetaSignatureCheckResult {
  const signatureHeader = opts.signatureHeader;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return { ok: false, reason: "missing_signature" };
  }

  if (opts.rawBody === undefined) {
    return { ok: false, reason: "missing_raw_body" };
  }

  const provided = signatureHeader.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", opts.appSecret)
    .update(opts.rawBody)
    .digest("hex");

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  const valid =
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!valid) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}

/**
 * Verifies Meta `X-Hub-Signature-256`.
 * Always required when WHATSAPP_APP_SECRET is configured.
 * When secret is missing (dev + ALLOW_INSECURE_WEBHOOK only), skips with a warning.
 */
export function verifyMetaSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isSecretConfigured(env.WHATSAPP_APP_SECRET)) {
    // Boot already enforced ALLOW_INSECURE_WEBHOOK for this case.
    next();
    return;
  }

  const result = checkMetaSignature({
    appSecret: env.WHATSAPP_APP_SECRET,
    signatureHeader: req.header("x-hub-signature-256") ?? undefined,
    rawBody: req.rawBody,
  });

  if (!result.ok) {
    if (result.reason === "missing_raw_body") {
      console.warn(
        "[webhook] Missing rawBody — rejecting (HMAC requires exact Meta payload bytes)"
      );
    } else if (result.reason === "missing_signature") {
      console.warn("[webhook] Missing or malformed X-Hub-Signature-256 header");
    } else {
      console.warn("[webhook] Invalid X-Hub-Signature-256 — rejecting payload");
    }
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  next();
}
