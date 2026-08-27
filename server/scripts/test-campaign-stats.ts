/**
 * Unit tests for campaign stats / reply attribution helpers (no DB).
 * Usage: npx ts-node --transpile-only scripts/test-campaign-stats.ts
 */
import {
  buildCampaignStats,
  emptyStatusCounts,
  pickReplyRecipient,
  shouldApplyDeliveryStatus,
} from "../src/services/campaign-stats";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function testFunnel(): void {
  const counts = emptyStatusCounts();
  counts.sent = 30;
  counts.delivered = 50;
  counts.read = 20;
  counts.failed = 10;
  counts.pending = 0;
  const stats = buildCampaignStats(110, counts, 18);
  assert(stats.funnel.sent === 100, "funnel sent = sent+delivered+read");
  assert(stats.funnel.delivered === 70, "funnel delivered = delivered+read");
  assert(stats.funnel.read === 20, "funnel read");
  assert(stats.funnel.failed === 10, "funnel failed");
  assert(stats.funnel.replied === 18, "funnel replied");
  assert(Math.abs(stats.rates.sent - 100 / 110) < 1e-9, "sent rate");
  assert(Math.abs(stats.rates.replied - 18 / 110) < 1e-9, "reply rate");
}

function testMonotonicStatus(): void {
  assert(shouldApplyDeliveryStatus("sent", "delivered"), "sent→delivered");
  assert(shouldApplyDeliveryStatus("delivered", "read"), "delivered→read");
  assert(!shouldApplyDeliveryStatus("read", "delivered"), "no downgrade read→delivered");
  assert(!shouldApplyDeliveryStatus("read", "sent"), "no downgrade read→sent");
  assert(shouldApplyDeliveryStatus("sent", "failed"), "sent→failed allowed");
  assert(!shouldApplyDeliveryStatus("cancelled", "delivered"), "cancelled sticky");
}

function testPickReply(): void {
  const a = {
    id: "a",
    waMessageId: "wamid.A",
    sentAt: new Date("2026-01-01T10:00:00Z"),
  };
  const b = {
    id: "b",
    waMessageId: "wamid.B",
    sentAt: new Date("2026-01-01T12:00:00Z"),
  };
  assert(
    pickReplyRecipient([a, b], "wamid.A")?.id === "a",
    "prefer explicit reply-to wa id"
  );
  assert(
    pickReplyRecipient([a, b], null)?.id === "b",
    "fallback to latest sentAt"
  );
  assert(pickReplyRecipient([], null) === null, "empty candidates");
}

testFunnel();
testMonotonicStatus();
testPickReply();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll campaign stats tests passed.");
