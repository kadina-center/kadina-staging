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

  const signatureHeader = req.header("x-hub-signature-256");
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    console.warn("[webhook] Missing or malformed X-Hub-Signature-256 header");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const provided = signatureHeader.slice("sha256=".length);
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  const expected = crypto
    .createHmac("sha256", env.WHATSAPP_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  const valid =
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!valid) {
    console.warn("[webhook] Invalid X-Hub-Signature-256 — rejecting payload");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  next();
}
