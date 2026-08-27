/**
 * Shared campaign metric helpers (pure) — used by API + broadcast + tests.
 */

export type RecipientStatusCounts = {
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  cancelled: number;
  sending: number;
};

export type CampaignFunnel = {
  /** Accepted by Meta (sent ∪ delivered ∪ read). */
  sent: number;
  /** Delivered or read. */
  delivered: number;
  read: number;
  failed: number;
  replied: number;
};

export type CampaignStatsPayload = {
  total: number;
  counts: RecipientStatusCounts & { replied: number };
  funnel: CampaignFunnel;
  rates: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    replied: number;
  };
};

export function emptyStatusCounts(): RecipientStatusCounts {
  return {
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    cancelled: 0,
    sending: 0,
  };
}

export function buildCampaignStats(
  total: number,
  counts: RecipientStatusCounts,
  replied: number
): CampaignStatsPayload {
  const funnel: CampaignFunnel = {
    sent: counts.sent + counts.delivered + counts.read,
    delivered: counts.delivered + counts.read,
    read: counts.read,
    failed: counts.failed,
    replied,
  };
  const denom = total > 0 ? total : 0;
  const rate = (n: number) => (denom ? n / denom : 0);
  return {
    total,
    counts: { ...counts, replied },
    funnel,
    rates: {
      sent: rate(funnel.sent),
      delivered: rate(funnel.delivered),
      read: rate(funnel.read),
      failed: rate(funnel.failed),
      replied: rate(funnel.replied),
    },
  };
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
  cancelled: 6,
};

/** Whether an incoming Meta status should overwrite the current recipient status. */
export function shouldApplyDeliveryStatus(
  current: string,
  incoming: string
): boolean {
  if (incoming === "failed") return current !== "failed" && current !== "cancelled";
  if (current === "failed" || current === "cancelled") return false;
  const cur = STATUS_RANK[current] ?? 0;
  const next = STATUS_RANK[incoming] ?? 0;
  return next >= cur;
}

export type ReplyCandidate = {
  id: string;
  waMessageId: string | null;
  sentAt: Date | null;
};

/**
 * Pick which CampaignRecipient an inbound reply should attribute to.
 * Priority: explicit reply-to waMessageId → latest sentAt within window.
 */
export function pickReplyRecipient(
  candidates: ReplyCandidate[],
  replyToWaMessageId: string | null | undefined
): ReplyCandidate | null {
  if (candidates.length === 0) return null;
  if (replyToWaMessageId) {
    const byWa = candidates.find((c) => c.waMessageId === replyToWaMessageId);
    if (byWa) return byWa;
  }
  const sorted = [...candidates].sort((a, b) => {
    const at = a.sentAt?.getTime() ?? 0;
    const bt = b.sentAt?.getTime() ?? 0;
    return bt - at;
  });
  return sorted[0] ?? null;
}
