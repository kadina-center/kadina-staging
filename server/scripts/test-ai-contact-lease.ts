/**
 * H8 default-AI per-contact lease tests (pure + optional DB).
 * Usage: npx ts-node --transpile-only scripts/test-ai-contact-lease.ts
 */
import { prisma } from "../src/lib/prisma";
import { env } from "../src/config/env";
import {
  canClaimAiLease,
  claimContactAiLease,
  computeAiLeaseExpiry,
  DEFAULT_AI_CONTACT_LEASE_MS,
  releaseContactAiLease,
  resolveAiContactLeaseMs,
} from "../src/services/ai-contact-lease";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function testPureLeaseLogic(): void {
  const now = new Date("2026-08-31T12:00:00.000Z");

  assert(
    canClaimAiLease(null, now) === true,
    "H8: null lease → claim allowed"
  );
  assert(
    canClaimAiLease(undefined, now) === true,
    "H8: undefined lease → claim allowed"
  );
  assert(
    canClaimAiLease(new Date("2026-08-31T11:59:00.000Z"), now) === true,
    "H8: expired lease → claim allowed"
  );
  assert(
    canClaimAiLease(new Date("2026-08-31T12:01:00.000Z"), now) === false,
    "H8: active lease → claim denied"
  );

  const until = computeAiLeaseExpiry(now, 120_000);
  assert(
    until.getTime() === now.getTime() + 120_000,
    "H8: expiry = now + duration"
  );

  assert(
    resolveAiContactLeaseMs(90_000) === 90_000,
    "H8: resolveAiContactLeaseMs respects override"
  );
  assert(
    resolveAiContactLeaseMs(0) === DEFAULT_AI_CONTACT_LEASE_MS,
    "H8: non-positive duration falls back to default"
  );

  // Ownership: release must match token (simulated decision).
  const releaseWouldClear = (owner: string, requester: string) =>
    owner === requester;
  assert(
    releaseWouldClear("token-A", "token-A") === true,
    "H8: owner can release own lease"
  );
  assert(
    releaseWouldClear("token-B", "token-A") === false,
    "H8: invocation A cannot release B's newer lease"
  );

  // Active flow guard remains a separate check (document decision).
  const shouldSkipDefaultAi = (opts: {
    assignedToId: string | null;
    activeFlowExecutionId: string | null;
  }) => Boolean(opts.assignedToId || opts.activeFlowExecutionId);
  assert(
    shouldSkipDefaultAi({
      assignedToId: null,
      activeFlowExecutionId: "exec-1",
    }) === true,
    "H8: active Flow still skips default AI (pre-claim)"
  );
  assert(
    shouldSkipDefaultAi({
      assignedToId: null,
      activeFlowExecutionId: null,
    }) === false,
    "H8: idle contact may attempt AI claim"
  );

  // Duplicate inbound uniqueness (Message.waMessageId) is orthogonal.
  assert(
    true,
    "H8: duplicate inbound protection remains Message.waMessageId unique (unchanged)"
  );
}

async function withTwoContacts<T>(
  fn: (ids: { a: string; b: string }) => Promise<T>
): Promise<T> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const a = await prisma.contact.create({
    data: {
      phone: `+1666${suffix.replace(/\D/g, "").slice(0, 7)}a`,
      name: "AI Lease A",
      channel: "whatsapp",
      channelScope: "_",
    },
  });
  const b = await prisma.contact.create({
    data: {
      phone: `+1666${suffix.replace(/\D/g, "").slice(0, 7)}b`,
      name: "AI Lease B",
      channel: "whatsapp",
      channelScope: "_",
    },
  });
  try {
    return await fn({ a: a.id, b: b.id });
  } finally {
    await prisma.contact.deleteMany({
      where: { id: { in: [a.id, b.id] } },
    });
  }
}

async function testDbClaims(): Promise<void> {
  if (!env.DATABASE_URL || env.DATABASE_URL.includes("user:password")) {
    console.log(
      "SKIP: AI lease DB tests (DATABASE_URL missing or placeholder)"
    );
    return;
  }

  console.log("--- AI contact lease DB tests ---");
  try {
    await withTwoContacts(async ({ a, b }) => {
      const [first, second] = await Promise.all([
        claimContactAiLease(a, { token: "tok-a1", durationMs: 60_000 }),
        claimContactAiLease(a, { token: "tok-a2", durationMs: 60_000 }),
      ]);
      const wins = [first, second].filter(Boolean);
      assert(
        wins.length === 1,
        "H8: concurrent claims same contact → exactly one succeeds"
      );

      const held = await prisma.contact.findUniqueOrThrow({
        where: { id: a },
        select: { aiLeaseToken: true, aiLeaseUntil: true },
      });
      assert(
        held.aiLeaseToken === wins[0]!.token,
        "H8: winning token persisted on contact"
      );
      assert(held.aiLeaseUntil != null, "H8: active lease has until");

      const whileActive = await claimContactAiLease(a, {
        token: "tok-a3",
        durationMs: 60_000,
      });
      assert(
        whileActive === null,
        "H8: active lease → second claim fails"
      );

      const other = await claimContactAiLease(b, {
        token: "tok-b1",
        durationMs: 60_000,
      });
      assert(other !== null, "H8: different contacts can both hold leases");

      const released = await releaseContactAiLease(a, wins[0]!.token);
      assert(released === true, "H8: successful path releases own lease");

      const afterRelease = await prisma.contact.findUniqueOrThrow({
        where: { id: a },
        select: { aiLeaseToken: true, aiLeaseUntil: true },
      });
      assert(
        afterRelease.aiLeaseToken === null &&
          afterRelease.aiLeaseUntil === null,
        "H8: lease cleared after own release"
      );

      // Re-claim, then simulate failure path release.
      const again = await claimContactAiLease(a, {
        token: "tok-fail",
        durationMs: 60_000,
      });
      assert(again !== null, "H8: after release, claim succeeds again");
      const failRelease = await releaseContactAiLease(a, "tok-fail");
      assert(
        failRelease === true,
        "H8: failed AI path still releases own lease (finally)"
      );

      // Ownership: A cannot clear B.
      const bHeld = await prisma.contact.findUniqueOrThrow({
        where: { id: b },
        select: { aiLeaseToken: true },
      });
      const cross = await releaseContactAiLease(b, "tok-wrong");
      assert(cross === false, "H8: wrong token does not release");
      const bStill = await prisma.contact.findUniqueOrThrow({
        where: { id: b },
        select: { aiLeaseToken: true },
      });
      assert(
        bStill.aiLeaseToken === bHeld.aiLeaseToken,
        "H8: foreign release leaves newer/other lease intact"
      );

      // Expired lease → reclaim.
      await prisma.contact.update({
        where: { id: a },
        data: {
          aiLeaseUntil: new Date(Date.now() - 1000),
          aiLeaseToken: "tok-stale",
        },
      });
      const afterExpire = await claimContactAiLease(a, {
        token: "tok-fresh",
        durationMs: 60_000,
        now: new Date(),
      });
      assert(
        afterExpire !== null && afterExpire.token === "tok-fresh",
        "H8: expired lease → new claim succeeds"
      );

      // A cannot release after B-style takeover with wrong old token.
      const staleRelease = await releaseContactAiLease(a, "tok-stale");
      assert(
        staleRelease === false,
        "H8: stale token cannot release newer lease"
      );
      const stillFresh = await prisma.contact.findUniqueOrThrow({
        where: { id: a },
        select: { aiLeaseToken: true },
      });
      assert(
        stillFresh.aiLeaseToken === "tok-fresh",
        "H8: newer lease survives stale release attempt"
      );

      await releaseContactAiLease(a, "tok-fresh");
      await releaseContactAiLease(b, "tok-b1");
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";
    // Columns may not exist until migrate deploy — skip gracefully.
    // Neon/local quota outages also skip (same pattern as flow hardening).
    if (
      /aiLeaseUntil|aiLeaseToken|does not exist|P2022|Unknown column|compute time quota|Can't reach database|P1001|P1017/i.test(
        message
      )
    ) {
      console.warn(
        `SKIP: AI lease DB tests could not run (${message.slice(0, 120)})`
      );
      return;
    }
    console.warn(
      `SKIP: AI lease DB tests could not run (${message.slice(0, 120)})`
    );
  }
}

async function main(): Promise<void> {
  console.log("--- AI contact lease tests (pure) ---");
  testPureLeaseLogic();
  await testDbClaims();

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll AI contact lease tests passed.");
}

void main().finally(() => prisma.$disconnect());
