/**
 * Pure helpers for campaign recipient crash recovery / duplicate-send prevention.
 * No DB access — unit-testable.
 */

/** Set on claim before Meta HTTP; cleared on successful sent. */
export const CAMPAIGN_SUBMIT_STARTED_MARKER = "__CAMPAIGN_SUBMIT_STARTED__";

/** Failed recipients with this prefix are excluded from retry-failed. */
export const CAMPAIGN_NO_AUTO_RETRY_PREFIX = "[NO_AUTO_RETRY]";

export const CAMPAIGN_INDETERMINATE_SUBMIT_ERROR =
  `${CAMPAIGN_NO_AUTO_RETRY_PREFIX} Interrupted while submitting to Meta; not auto-retried to avoid duplicate WhatsApp sends. Verify delivery in Meta before any manual retry.`;

export type SendingRecoveryAction =
  | "promote_sent"
  | "indeterminate_fail"
  | "release_pending";

/**
 * Decide how to recover a CampaignRecipient stuck in status=sending after
 * pause/interrupt/restart.
 *
 * - waMessageId present → Meta accepted and we persisted id → promote to sent
 * - submit-started marker, no waMessageId → Meta may have accepted → do NOT resend
 * - no marker → crash/claim before Meta call → safe to release to pending
 */
export function classifySendingRecipientRecovery(row: {
  waMessageId: string | null | undefined;
  errorMessage: string | null | undefined;
}): SendingRecoveryAction {
  if (row.waMessageId) return "promote_sent";
  if (row.errorMessage === CAMPAIGN_SUBMIT_STARTED_MARKER) {
    return "indeterminate_fail";
  }
  if (
    typeof row.errorMessage === "string" &&
    row.errorMessage.startsWith(CAMPAIGN_NO_AUTO_RETRY_PREFIX)
  ) {
    return "indeterminate_fail";
  }
  return "release_pending";
}

/** retry-failed must not auto-retry indeterminate Meta-submit crashes. */
export function isAutoRetryableFailedRecipient(
  errorMessage: string | null | undefined
): boolean {
  if (!errorMessage) return true;
  if (errorMessage === CAMPAIGN_SUBMIT_STARTED_MARKER) return false;
  if (errorMessage.startsWith(CAMPAIGN_NO_AUTO_RETRY_PREFIX)) return false;
  return true;
}

export type PostSubmitCatchAction =
  | "force_sent"
  | "indeterminate_fail"
  | "retryable_fail";

/**
 * Catch-path decision after Meta send attempt.
 * Uses whether the submit marker was successfully persisted — not merely
 * whether Meta was invoked.
 */
export function classifyPostSubmitCatch(opts: {
  acceptedWaMessageId: string | null | undefined;
  submitMarkerWasPersisted: boolean;
}): PostSubmitCatchAction {
  if (opts.acceptedWaMessageId) return "force_sent";
  if (opts.submitMarkerWasPersisted) return "indeterminate_fail";
  return "retryable_fail";
}

/** Pure: enqueue vs defer vs skip when a campaign already has a worker/slot. */
export function classifyCampaignEnqueue(opts: {
  campaignId: string;
  activeIds: ReadonlySet<string>;
  queuedIds: ReadonlyArray<string>;
}): "enqueue" | "defer" | "skip" {
  if (opts.queuedIds.includes(opts.campaignId)) return "skip";
  if (opts.activeIds.has(opts.campaignId)) return "defer";
  return "enqueue";
}

/**
 * Pure: after stranded recovery, whether the campaign may complete.
 * Never complete while pending or sending recipients remain.
 */
export function decideCampaignEndAfterRecovery(counts: {
  pending: number;
  sending: number;
}): "requeue_pending" | "leave_sending" | "complete" {
  if (counts.pending > 0) return "requeue_pending";
  if (counts.sending > 0) return "leave_sending";
  return "complete";
}
