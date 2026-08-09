import axios from "axios";
import crypto from "crypto";
import { prisma } from "../lib/prisma";

/**
 * Outgoing webhook dispatcher for Zapier/Make/custom integrations.
 * Signs payloads with HMAC-SHA256 (X-Signature) using each subscription secret.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signPayload(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function subscriptionMatches(eventsCsv: string, eventName: string): boolean {
  return eventsCsv
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .includes(eventName);
}

async function postWithRetry(
  url: string,
  body: string,
  signature: string
): Promise<void> {
  const delays = [0, 1000, 3000];
  let lastError: unknown;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    try {
      const res = await axios.post(url, body, {
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Webhook-Attempt": String(attempt + 1),
        },
        timeout: 10000,
        validateStatus: (status) => status >= 200 && status < 300,
        transformRequest: [(data) => data],
      });
      if (res.status >= 200 && res.status < 300) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Webhook delivery failed");
}

export async function dispatchEvent(
  eventName: string,
  payload: object
): Promise<void> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { isActive: true },
  });

  const targets = subscriptions.filter((s) =>
    subscriptionMatches(s.events, eventName)
  );
  if (targets.length === 0) return;

  const envelope = {
    event: eventName,
    timestamp: new Date().toISOString(),
    data: payload,
  };
  const body = JSON.stringify(envelope);

  await Promise.allSettled(
    targets.map(async (sub) => {
      const signature = signPayload(sub.secret, body);
      try {
        await postWithRetry(sub.url, body, signature);
      } catch (error) {
        console.error(
          `[webhook-dispatcher] Failed ${eventName} → ${sub.url}:`,
          error instanceof Error ? error.message : error
        );
      }
    })
  );
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}
