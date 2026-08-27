/**
 * Unit tests for ScheduledJob atomic claim + stale recovery helpers (no DB).
 * Usage: npx ts-node --transpile-only scripts/test-scheduled-jobs.ts
 */
import {
  isStaleRunning,
  nextStatusAfterHandler,
  simulateConcurrentClaimsOnOneJob,
  STALE_RUNNING_MS,
  wonAtomicClaim,
} from "../src/services/scheduled-jobs.service";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function testClaimSemantics(): void {
  assert(wonAtomicClaim(1) === true, "pending → running claim wins when count=1");
  assert(wonAtomicClaim(0) === false, "skip when count=0 (already claimed)");
  assert(wonAtomicClaim(2) === false, "unexpected count>1 is not a win");

  const race = simulateConcurrentClaimsOnOneJob();
  assert(race.first === 1, "first concurrent claimer gets count=1");
  assert(race.second === 0, "second concurrent claimer gets count=0");
  assert(race.winners === 1, "exactly one worker executes the handler");
}

function testLifecycleStatuses(): void {
  assert(
    nextStatusAfterHandler({ success: true, attemptsAfterFailure: 0 }) ===
      "done",
    "pending → running → done on success"
  );
  assert(
    nextStatusAfterHandler({
      success: false,
      attemptsAfterFailure: 1,
    }) === "pending",
    "failed handler → retry → pending"
  );
  assert(
    nextStatusAfterHandler({
      success: false,
      attemptsAfterFailure: 4,
    }) === "pending",
    "attempt 4 still pending (max 5)"
  );
  assert(
    nextStatusAfterHandler({
      success: false,
      attemptsAfterFailure: 5,
    }) === "failed",
    "exhausted retries → failed"
  );
}

function testStaleRecovery(): void {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const fresh = new Date(now.getTime() - STALE_RUNNING_MS + 60_000);
  const stale = new Date(now.getTime() - STALE_RUNNING_MS - 1);
  assert(
    !isStaleRunning(fresh, now),
    "running job younger than 15m is not stale"
  );
  assert(
    isStaleRunning(stale, now),
    "stale running job (≥15m) → eligible for pending recovery"
  );
}

function testFlowResumeOnceViaClaim(): void {
  // Duplicate flow.resume jobs: only the claim winner runs the handler once.
  let handlerRuns = 0;
  const race = simulateConcurrentClaimsOnOneJob();
  if (wonAtomicClaim(race.first)) handlerRuns += 1;
  if (wonAtomicClaim(race.second)) handlerRuns += 1;
  assert(
    handlerRuns === 1,
    "duplicate flow.resume claim race → handler executes only once"
  );
}

function testCampaignScheduleUnchangedSemantics(): void {
  // Campaign soft wake-up still relies on status==="scheduled" in the handler;
  // claim only gates job execution, not Campaign.status.
  assert(
    wonAtomicClaim(1) &&
      nextStatusAfterHandler({ success: true, attemptsAfterFailure: 0 }) ===
        "done",
    "campaign scheduling claim path still completes to done"
  );
}

console.log("--- scheduled-jobs concurrency tests ---");
testClaimSemantics();
testLifecycleStatuses();
testStaleRecovery();
testFlowResumeOnceViaClaim();
testCampaignScheduleUnchangedSemantics();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll scheduled-jobs tests passed.");
