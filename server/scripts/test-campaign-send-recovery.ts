/**
 * Unit tests for campaign send crash recovery / duplicate prevention (no DB).
 * Usage: npx ts-node --transpile-only scripts/test-campaign-send-recovery.ts
 */
import { shouldApplyDeliveryStatus } from "../src/services/campaign-stats";
import {
  CAMPAIGN_INDETERMINATE_SUBMIT_ERROR,
  CAMPAIGN_NO_AUTO_RETRY_PREFIX,
  CAMPAIGN_SUBMIT_STARTED_MARKER,
  classifyCampaignEnqueue,
  classifyPostSubmitCatch,
  classifySendingRecipientRecovery,
  decideCampaignEndAfterRecovery,
  isAutoRetryableFailedRecipient,
} from "../src/services/campaign-send-recovery";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

/** Simulate drainQueue finally: clear active, then honor deferred requeue. */
function simulateDeferredRequeueLifecycle(campaignId: string): {
  deferredWhileActive: boolean;
  queuedAfterRelease: boolean;
} {
  const active = new Set<string>([campaignId]);
  const queued: string[] = [];
  const pendingRequeue = new Set<string>();

  const enqueue = (id: string): void => {
    const d = classifyCampaignEnqueue({
      campaignId: id,
      activeIds: active,
      queuedIds: queued,
    });
    if (d === "skip") return;
    if (d === "defer") {
      pendingRequeue.add(id);
      return;
    }
    active.add(id);
    queued.push(id);
  };

  // Mid-processCampaign stranded recovery tries to re-enqueue while still active.
  enqueue(campaignId);
  const deferredWhileActive =
    pendingRequeue.has(campaignId) && queued.length === 0;

  // drainQueue finally
  active.delete(campaignId);
  if (pendingRequeue.has(campaignId)) {
    pendingRequeue.delete(campaignId);
    enqueue(campaignId);
  }

  return {
    deferredWhileActive,
    queuedAfterRelease: queued.includes(campaignId),
  };
}

function testEnqueueDoesNotStrandWhenActive(): void {
  const r = simulateDeferredRequeueLifecycle("camp-1");
  assert(
    r.deferredWhileActive === true,
    "H1: re-enqueue while active is deferred (not silently dropped)"
  );
  assert(
    r.queuedAfterRelease === true,
    "H1: after active cleared, deferred re-enqueue schedules work"
  );
  assert(
    classifyCampaignEnqueue({
      campaignId: "c",
      activeIds: new Set(["c"]),
      queuedIds: [],
    }) === "defer",
    "H1: classifyCampaignEnqueue → defer when active"
  );
  assert(
    classifyCampaignEnqueue({
      campaignId: "c",
      activeIds: new Set(),
      queuedIds: ["c"],
    }) === "skip",
    "H1: already queued → skip (no duplicate queue slots)"
  );
  assert(
    classifyCampaignEnqueue({
      campaignId: "c",
      activeIds: new Set(),
      queuedIds: [],
    }) === "enqueue",
    "H1: idle campaign → enqueue"
  );
}

function testCompletionGate(): void {
  assert(
    decideCampaignEndAfterRecovery({ pending: 1, sending: 0 }) ===
      "requeue_pending",
    "H2: pending>0 → must not complete"
  );
  assert(
    decideCampaignEndAfterRecovery({ pending: 0, sending: 1 }) ===
      "leave_sending",
    "H2: sending>0 → must not complete"
  );
  assert(
    decideCampaignEndAfterRecovery({ pending: 2, sending: 3 }) ===
      "requeue_pending",
    "H2: pending wins when both remain"
  );
  assert(
    decideCampaignEndAfterRecovery({ pending: 0, sending: 0 }) === "complete",
    "H2: pending=0 and sending=0 → complete"
  );
}

/** Simulate atomic pending→sending claim race (same as updateMany count). */
function simulateConcurrentClaims(): { first: number; second: number } {
  let status = "pending";
  const claim = (): number => {
    if (status !== "pending") return 0;
    status = "sending";
    return 1;
  };
  return { first: claim(), second: claim() };
}

/** Heal path: only write when waMessageId still null. */
function simulateForcePersist(
  row: { status: string; waMessageId: string | null },
  acceptedId: string
): { status: string; waMessageId: string | null } {
  if (row.waMessageId !== null) return { ...row };
  return { status: "sent", waMessageId: acceptedId };
}

function testCrashBeforeMeta(): void {
  assert(
    classifySendingRecipientRecovery({
      waMessageId: null,
      errorMessage: null,
    }) === "release_pending",
    "D-pre: crash after claim, before submit marker → release_pending"
  );
}

function testCrashAfterMetaBeforeDb(): void {
  assert(
    classifySendingRecipientRecovery({
      waMessageId: null,
      errorMessage: CAMPAIGN_SUBMIT_STARTED_MARKER,
    }) === "indeterminate_fail",
    "D: hard crash after marker → recovery indeterminate_fail (no auto pending)"
  );
}

function testCatchHoleClosed(): void {
  assert(
    classifyPostSubmitCatch({
      acceptedWaMessageId: null,
      submitMarkerWasPersisted: true,
    }) === "indeterminate_fail",
    "A: marker persisted + Meta throw/no id → indeterminate_fail"
  );
  assert(
    isAutoRetryableFailedRecipient(CAMPAIGN_INDETERMINATE_SUBMIT_ERROR) ===
      false,
    "A: indeterminate error excluded from retry-failed"
  );

  assert(
    classifyPostSubmitCatch({
      acceptedWaMessageId: "wamid.OK",
      submitMarkerWasPersisted: true,
    }) === "force_sent",
    "B: marker + valid Meta id → force_sent"
  );

  assert(
    classifyPostSubmitCatch({
      acceptedWaMessageId: null,
      submitMarkerWasPersisted: false,
    }) === "retryable_fail",
    "C: marker NOT persisted + failure → retryable_fail"
  );
}

function testCrashAfterDbSent(): void {
  assert(
    classifySendingRecipientRecovery({
      waMessageId: "wamid.OK",
      errorMessage: CAMPAIGN_SUBMIT_STARTED_MARKER,
    }) === "promote_sent",
    "B/D: waMessageId while sending → promote_sent"
  );
}

function testConcurrentClaim(): void {
  const { first, second } = simulateConcurrentClaims();
  assert(first === 1, "F: first worker claim wins");
  assert(second === 0, "F: second worker claim loses");
}

function testHealDoesNotOverwriteSent(): void {
  assert(
    simulateForcePersist({ status: "sent", waMessageId: "wamid.A" }, "wamid.B")
      .waMessageId === "wamid.A",
    "F: force-persist does not overwrite existing waMessageId"
  );
  assert(
    simulateForcePersist({ status: "sending", waMessageId: null }, "wamid.B")
      .waMessageId === "wamid.B",
    "F: force-persist fills null waMessageId → sent"
  );
}

function testRetryFailedExclusions(): void {
  assert(
    isAutoRetryableFailedRecipient("Meta rate limit") === true,
    "E: ordinary failed is retryable"
  );
  assert(
    isAutoRetryableFailedRecipient(null) === true,
    "E: null error is retryable"
  );
  assert(
    isAutoRetryableFailedRecipient(CAMPAIGN_SUBMIT_STARTED_MARKER) === false,
    "E: submit marker not retryable"
  );
  assert(
    isAutoRetryableFailedRecipient(CAMPAIGN_INDETERMINATE_SUBMIT_ERROR) ===
      false,
    "E: NO_AUTO_RETRY indeterminate not retryable"
  );
  assert(
    isAutoRetryableFailedRecipient(
      `${CAMPAIGN_NO_AUTO_RETRY_PREFIX} custom`
    ) === false,
    "E: any NO_AUTO_RETRY prefix excluded"
  );
}

function testPauseResumeCancelSemantics(): void {
  assert(
    classifySendingRecipientRecovery({
      waMessageId: null,
      errorMessage: CAMPAIGN_SUBMIT_STARTED_MARKER,
    }) !== "release_pending",
    "pause/resume must not release submit-started to pending"
  );
  assert(
    classifySendingRecipientRecovery({
      waMessageId: null,
      errorMessage: null,
    }) === "release_pending",
    "clean in-flight without Meta start can return to pending"
  );
}

function testWebhookMonotonicStillApplies(): void {
  assert(
    shouldApplyDeliveryStatus("sent", "delivered") === true,
    "webhook: sent→delivered allowed"
  );
  assert(
    shouldApplyDeliveryStatus("read", "sent") === false,
    "webhook: no status downgrade"
  );
  assert(
    shouldApplyDeliveryStatus("cancelled", "delivered") === false,
    "webhook: cancelled sticky"
  );
}

console.log("--- campaign send recovery tests ---");
testEnqueueDoesNotStrandWhenActive();
testCompletionGate();
testCrashBeforeMeta();
testCrashAfterMetaBeforeDb();
testCatchHoleClosed();
testCrashAfterDbSent();
testConcurrentClaim();
testHealDoesNotOverwriteSent();
testRetryFailedExclusions();
testPauseResumeCancelSemantics();
testWebhookMonotonicStillApplies();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll campaign send recovery tests passed.");
