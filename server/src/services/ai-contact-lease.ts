/**
 * Durable per-contact lease for default AI concurrency.
 * Pure helpers are unit-testable; DB claim/release use conditional updateMany
 * (no long-lived SQL transaction around Anthropic/Meta HTTP).
 */
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

/** Default TTL when env is unavailable (tests / pure helpers). */
export const DEFAULT_AI_CONTACT_LEASE_MS = 120_000;

export function resolveAiContactLeaseMs(
  configuredMs?: number
): number {
  const ms =
    typeof configuredMs === "number" && Number.isFinite(configuredMs)
      ? configuredMs
      : env.AI_CONTACT_LEASE_MS;
  return ms > 0 ? ms : DEFAULT_AI_CONTACT_LEASE_MS;
}

/**
 * Pure: may claim when no lease, or existing lease is already expired.
 */
export function canClaimAiLease(
  aiLeaseUntil: Date | null | undefined,
  now: Date
): boolean {
  if (aiLeaseUntil == null) return true;
  return aiLeaseUntil.getTime() < now.getTime();
}

export function computeAiLeaseExpiry(
  now: Date,
  durationMs: number
): Date {
  return new Date(now.getTime() + durationMs);
}

export type AiLeaseClaim = {
  token: string;
  until: Date;
};

/**
 * Atomic claim: succeeds only if idle or expired.
 * Does not hold a transaction open across AI/Meta work.
 */
export async function claimContactAiLease(
  contactId: string,
  opts?: { now?: Date; durationMs?: number; token?: string }
): Promise<AiLeaseClaim | null> {
  const now = opts?.now ?? new Date();
  const durationMs = resolveAiContactLeaseMs(opts?.durationMs);
  const token = opts?.token ?? randomUUID();
  const until = computeAiLeaseExpiry(now, durationMs);

  const updated = await prisma.contact.updateMany({
    where: {
      id: contactId,
      OR: [{ aiLeaseUntil: null }, { aiLeaseUntil: { lt: now } }],
    },
    data: {
      aiLeaseUntil: until,
      aiLeaseToken: token,
    },
  });

  if (updated.count !== 1) return null;
  return { token, until };
}

/**
 * Release only if this invocation still owns the lease token.
 * Never clears a newer lease acquired after expiry/crash recovery.
 */
export async function releaseContactAiLease(
  contactId: string,
  token: string
): Promise<boolean> {
  const updated = await prisma.contact.updateMany({
    where: {
      id: contactId,
      aiLeaseToken: token,
    },
    data: {
      aiLeaseUntil: null,
      aiLeaseToken: null,
    },
  });
  return updated.count === 1;
}
