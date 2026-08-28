import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  buildCampaignStats,
  emptyStatusCounts,
  pickReplyRecipient,
  shouldApplyDeliveryStatus,
  type CampaignStatsPayload,
} from "./campaign-stats";
import {
  CAMPAIGN_INDETERMINATE_SUBMIT_ERROR,
  CAMPAIGN_SUBMIT_STARTED_MARKER,
  classifyPostSubmitCatch,
  classifySendingRecipientRecovery,
  isAutoRetryableFailedRecipient,
} from "./campaign-send-recovery";
import { enqueueScheduledJob, registerJobHandler } from "./scheduled-jobs.service";
import { emitCampaignProgress } from "./socket.service";
import { dispatchEvent } from "./webhook-dispatcher.service";
import {
  TimelineEventType,
  actorAutomation,
  logTimeline,
} from "./timeline.service";
import { sendTemplateMessage } from "./whatsapp.service";

/**
 * In-app broadcast queue (one campaign at a time) + durable ScheduledJob
 * for scheduled starts. Batch size/delay respect Meta rate limits via ENV.
 */

type QueueJob = {
  campaignId: string;
};

const queue: QueueJob[] = [];
let processing = false;
const activeCampaignIds = new Set<string>();
/** Soft in-process reminder only — persistence is ScheduledJob. */
const scheduledTimers = new Map<string, NodeJS.Timeout>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RecoverSendingResult = {
  promotedSent: number;
  indeterminateFailed: number;
  releasedPending: number;
};

/**
 * Recover recipients stuck in status=sending without blindly re-opening Meta submits.
 * Used by pause interrupt, end-of-loop stranded cleanup, resume, and boot recovery.
 */
export async function recoverSendingRecipients(opts?: {
  campaignId?: string;
}): Promise<RecoverSendingResult> {
  const where = {
    status: "sending" as const,
    ...(opts?.campaignId ? { campaignId: opts.campaignId } : {}),
  };

  const rows = await prisma.campaignRecipient.findMany({
    where,
    select: {
      id: true,
      waMessageId: true,
      errorMessage: true,
      sentAt: true,
      campaignId: true,
    },
  });

  const result: RecoverSendingResult = {
    promotedSent: 0,
    indeterminateFailed: 0,
    releasedPending: 0,
  };

  for (const row of rows) {
    const action = classifySendingRecipientRecovery(row);

    if (action === "promote_sent") {
      const updated = await prisma.campaignRecipient.updateMany({
        where: {
          id: row.id,
          status: "sending",
          waMessageId: { not: null },
        },
        data: {
          status: "sent",
          errorMessage: null,
          ...(row.sentAt ? {} : { sentAt: new Date() }),
        },
      });
      if (updated.count === 1) {
        result.promotedSent += 1;
        console.log(
          `[broadcast] recipient=${row.id} recovered: sending→sent (waMessageId persisted)`
        );
      }
      continue;
    }

    if (action === "indeterminate_fail") {
      const updated = await prisma.campaignRecipient.updateMany({
        where: {
          id: row.id,
          status: "sending",
          waMessageId: null,
        },
        data: {
          status: "failed",
          errorMessage: CAMPAIGN_INDETERMINATE_SUBMIT_ERROR,
        },
      });
      if (updated.count === 1) {
        result.indeterminateFailed += 1;
        console.log(
          `[broadcast] recipient=${row.id} recovered: sending→failed (submit started; skip auto-resend)`
        );
      }
      continue;
    }

    const updated = await prisma.campaignRecipient.updateMany({
      where: {
        id: row.id,
        status: "sending",
        waMessageId: null,
        OR: [
          { errorMessage: null },
          { errorMessage: { not: CAMPAIGN_SUBMIT_STARTED_MARKER } },
        ],
      },
      data: {
        status: "pending",
        errorMessage: null,
      },
    });
    // Guard: never release a submit-started marker via the OR branch if Prisma
    // matched an unexpected row — re-check would require another read; the
    // `not: MARKER` clause excludes the marker value itself.
    if (updated.count === 1) {
      result.releasedPending += 1;
      console.log(
        `[broadcast] recipient=${row.id} recovered: sending→pending (Meta not started)`
      );
    }
  }

  return result;
}

export async function getCampaignStats(
  campaignId: string
): Promise<CampaignStatsPayload> {
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const counts = emptyStatusCounts();
  let total = 0;
  for (const row of grouped) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = row._count._all;
    }
    total += row._count._all;
  }

  const replied = await prisma.campaignRecipient.count({
    where: { campaignId, repliedAt: { not: null } },
  });

  return buildCampaignStats(total, counts, replied);
}

async function getProgress(campaignId: string) {
  const stats = await getCampaignStats(campaignId);
  const processed =
    stats.funnel.sent + stats.funnel.failed + (stats.counts.cancelled || 0);
  return {
    total: stats.total,
    processed,
    counts: stats.counts,
    funnel: stats.funnel,
    rates: stats.rates,
  };
}

async function processCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, channel: true },
  });

  if (!campaign) return;

  if (
    campaign.status === "cancelled" ||
    campaign.status === "completed" ||
    campaign.status === "paused"
  ) {
    return;
  }

  if (!campaign.channelId || !campaign.channel?.isActive) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "failed" },
    });
    emitCampaignProgress({
      campaignId,
      status: "failed",
      error: "Campaign has no active WhatsApp channel",
      ...(await getProgress(campaignId)),
    });
    return;
  }

  if (campaign.template.status !== "approved") {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "failed" },
    });
    emitCampaignProgress({
      campaignId,
      status: "failed",
      error: "Template is not approved",
      ...(await getProgress(campaignId)),
    });
    return;
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "sending" },
  });

  emitCampaignProgress({
    campaignId,
    status: "sending",
    ...(await getProgress(campaignId)),
  });

  const batchSize = env.BROADCAST_BATCH_SIZE;
  const delayMs = env.BROADCAST_BATCH_DELAY_MS;

  let hasMore = true;
  let interrupted = false;
  while (hasMore) {
    const current = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!current || current.status !== "sending") {
      interrupted = true;
      break;
    }

    const batch = await prisma.campaignRecipient.findMany({
      where: { campaignId, status: "pending" },
      take: batchSize,
      include: { contact: true },
      orderBy: { id: "asc" },
    });

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    for (const recipient of batch) {
      // Re-check campaign pause/cancel between recipients
      const live = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!live || live.status !== "sending") {
        interrupted = true;
        hasMore = false;
        break;
      }

      // Atomic claim — prevents double-send on worker overlap / restart races.
      // Submit marker is applied in a second step immediately before Meta.
      const claim = await prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, status: "pending" },
        data: {
          status: "sending",
          errorMessage: null,
        },
      });
      if (claim.count === 0) {
        console.log(
          `[broadcast] recipient=${recipient.id} claim skipped (already claimed)`
        );
        continue;
      }
      console.log(
        `[broadcast] recipient=${recipient.id} claimed pending→sending`
      );

      if (recipient.contact.optedOut) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "failed",
            errorMessage: "Contact opted out",
          },
        });
        emitCampaignProgress({
          campaignId,
          recipientId: recipient.id,
          contactId: recipient.contactId,
          recipientStatus: "failed",
          ...(await getProgress(campaignId)),
          status: "sending",
        });
        void logTimeline({
          contactId: recipient.contactId,
          eventType: TimelineEventType.CAMPAIGN_FAILED,
          title: "فشل إرسال حملة",
          description: "Contact opted out",
          actor: actorAutomation("Campaign"),
          metadata: {
            campaignId,
            recipientId: recipient.id,
            errorMessage: "Contact opted out",
          },
        });
        continue;
      }

      let acceptedWaMessageId: string | null = null;
      let submitMarkerWasPersisted = false;
      try {
        // Durable evidence that Meta HTTP is about to start / may have started.
        const marked = await prisma.campaignRecipient.updateMany({
          where: {
            id: recipient.id,
            status: "sending",
            waMessageId: null,
          },
          data: { errorMessage: CAMPAIGN_SUBMIT_STARTED_MARKER },
        });
        if (marked.count !== 1) {
          console.log(
            `[broadcast] recipient=${recipient.id} submit mark skipped (state changed)`
          );
          continue;
        }
        submitMarkerWasPersisted = true;

        console.log(
          `[broadcast] recipient=${recipient.id} Meta template send attempted`
        );
        const { waMessageId } = await sendTemplateMessage(
          recipient.contact.phone,
          campaign.template.name,
          campaign.template.language,
          [],
          campaign.channelId
        );
        acceptedWaMessageId = waMessageId;
        console.log(
          `[broadcast] recipient=${recipient.id} Meta accepted waMessageId=${waMessageId}`
        );

        const persisted = await prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, status: "sending" },
          data: {
            status: "sent",
            waMessageId,
            sentAt: new Date(),
            errorMessage: null,
          },
        });
        if (persisted.count !== 1) {
          // Best-effort heal if status raced; never drop a known Meta id.
          await prisma.campaignRecipient.updateMany({
            where: { id: recipient.id, waMessageId: null },
            data: {
              status: "sent",
              waMessageId,
              sentAt: new Date(),
              errorMessage: null,
            },
          });
          console.warn(
            `[broadcast] recipient=${recipient.id} Meta accepted; healed DB sent (initial count=${persisted.count})`
          );
        } else {
          console.log(
            `[broadcast] recipient=${recipient.id} DB persisted sending→sent`
          );
        }

        emitCampaignProgress({
          campaignId,
          recipientId: recipient.id,
          contactId: recipient.contactId,
          recipientStatus: "sent",
          waMessageId,
          ...(await getProgress(campaignId)),
          status: "sending",
        });
        void logTimeline({
          contactId: recipient.contactId,
          eventType: TimelineEventType.CAMPAIGN_SENT,
          title: "إرسال حملة",
          description: campaign.name,
          actor: actorAutomation("Campaign"),
          metadata: {
            campaignId,
            recipientId: recipient.id,
            waMessageId,
            templateName: campaign.template.name,
          },
        });
      } catch (error) {
        const catchAction = classifyPostSubmitCatch({
          acceptedWaMessageId,
          submitMarkerWasPersisted,
        });

        if (catchAction === "force_sent" && acceptedWaMessageId) {
          // Meta already accepted — persist evidence; do not mark retryable failed.
          // Only fills waMessageId when still null — never clears an existing id.
          await prisma.campaignRecipient.updateMany({
            where: { id: recipient.id, waMessageId: null },
            data: {
              status: "sent",
              waMessageId: acceptedWaMessageId,
              sentAt: new Date(),
              errorMessage: null,
            },
          });
          console.error(
            `[broadcast] recipient=${recipient.id} Meta accepted but post-accept path failed; forced sent persistence`,
            error instanceof Error ? error.message : error
          );
          emitCampaignProgress({
            campaignId,
            recipientId: recipient.id,
            contactId: recipient.contactId,
            recipientStatus: "sent",
            waMessageId: acceptedWaMessageId,
            ...(await getProgress(campaignId)),
            status: "sending",
          });
          continue;
        }

        if (catchAction === "indeterminate_fail") {
          // Marker was persisted; Meta result unknown — never retryable.
          const indeterminateError = CAMPAIGN_INDETERMINATE_SUBMIT_ERROR;
          await prisma.campaignRecipient.updateMany({
            where: {
              id: recipient.id,
              status: "sending",
              waMessageId: null,
            },
            data: {
              status: "failed",
              errorMessage: indeterminateError,
            },
          });
          console.error(
            `[broadcast] recipient=${recipient.id} indeterminate Meta submit (marker set, no waMessageId); marked NO_AUTO_RETRY`,
            error instanceof Error ? error.message : error
          );
          emitCampaignProgress({
            campaignId,
            recipientId: recipient.id,
            contactId: recipient.contactId,
            recipientStatus: "failed",
            error: indeterminateError,
            ...(await getProgress(campaignId)),
            status: "sending",
          });
          void logTimeline({
            contactId: recipient.contactId,
            eventType: TimelineEventType.CAMPAIGN_FAILED,
            title: "فشل إرسال حملة",
            description: indeterminateError,
            actor: actorAutomation("Campaign"),
            metadata: {
              campaignId,
              recipientId: recipient.id,
              errorMessage: indeterminateError,
              reason: "indeterminate_submit",
            },
          });
          continue;
        }

        const errorMessage =
          error instanceof Error ? error.message : "Send failed";

        await prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, status: "sending" },
          data: {
            status: "failed",
            errorMessage,
          },
        });

        emitCampaignProgress({
          campaignId,
          recipientId: recipient.id,
          contactId: recipient.contactId,
          recipientStatus: "failed",
          error: errorMessage,
          ...(await getProgress(campaignId)),
          status: "sending",
        });
        void logTimeline({
          contactId: recipient.contactId,
          eventType: TimelineEventType.CAMPAIGN_FAILED,
          title: "فشل إرسال حملة",
          description: errorMessage,
          actor: actorAutomation("Campaign"),
          metadata: {
            campaignId,
            recipientId: recipient.id,
            errorMessage,
          },
        });
      }
    }

    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId, status: "pending" },
    });
    if (remaining > 0 && !interrupted) {
      await sleep(delayMs);
    }
  }

  if (interrupted) {
    const recovered = await recoverSendingRecipients({ campaignId });
    console.log(
      `[broadcast] campaign=${campaignId} interrupt recovery promoted=${recovered.promotedSent} indeterminate=${recovered.indeterminateFailed} pending=${recovered.releasedPending}`
    );
    const progress = await getProgress(campaignId);
    const finalStatus = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    emitCampaignProgress({
      campaignId,
      status: finalStatus?.status ?? "paused",
      ...progress,
    });
    return;
  }

  const stranded = await recoverSendingRecipients({ campaignId });
  if (stranded.releasedPending > 0) {
    console.log(
      `[broadcast] campaign=${campaignId} stranded pending re-queue count=${stranded.releasedPending}`
    );
    enqueueCampaignSend(campaignId);
    return;
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "completed" },
  });

  const progress = await getProgress(campaignId);

  emitCampaignProgress({
    campaignId,
    status: "completed",
    ...progress,
  });

  void dispatchEvent("campaign.completed", {
    campaignId,
    name: campaign.name,
    templateId: campaign.templateId,
    ...progress,
  });
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      try {
        await processCampaign(job.campaignId);
      } catch (error) {
        console.error("[broadcast] Campaign failed:", error);
        await prisma.campaign
          .update({
            where: { id: job.campaignId },
            data: { status: "failed" },
          })
          .catch(() => undefined);
        emitCampaignProgress({
          campaignId: job.campaignId,
          status: "failed",
          error: error instanceof Error ? error.message : "Campaign failed",
          ...(await getProgress(job.campaignId).catch(() => ({
            total: 0,
            processed: 0,
            counts: {},
          }))),
        });
      } finally {
        activeCampaignIds.delete(job.campaignId);
      }
    }
  } finally {
    processing = false;
  }
}

export function enqueueCampaignSend(campaignId: string): void {
  if (activeCampaignIds.has(campaignId)) return;
  if (queue.some((j) => j.campaignId === campaignId)) return;

  activeCampaignIds.add(campaignId);
  queue.push({ campaignId });
  void drainQueue();
}

export function scheduleCampaignSend(
  campaignId: string,
  scheduledAt: Date
): void {
  const existing = scheduledTimers.get(campaignId);
  if (existing) clearTimeout(existing);

  // Soft in-process wake-up only. Durable source of truth = ScheduledJob.
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  if (delay <= 2_147_000_000) {
    const timer = setTimeout(() => {
      scheduledTimers.delete(campaignId);
      // Only enqueue if still scheduled — durable job has the same gate.
      void prisma.campaign
        .findUnique({
          where: { id: campaignId },
          select: { status: true },
        })
        .then((c) => {
          if (c?.status === "scheduled") enqueueCampaignSend(campaignId);
        })
        .catch(() => undefined);
    }, delay);
    scheduledTimers.set(campaignId, timer);
  }

  void enqueueScheduledJob("campaign.send", scheduledAt, { campaignId });
}

export function cancelScheduledCampaignTimer(campaignId: string): void {
  const existing = scheduledTimers.get(campaignId);
  if (existing) {
    clearTimeout(existing);
    scheduledTimers.delete(campaignId);
  }
}

/** Mark pending durable schedule jobs for this campaign as done (cancel). */
export async function cancelCampaignScheduledJobs(
  campaignId: string
): Promise<void> {
  const pending = await prisma.scheduledJob.findMany({
    where: { type: "campaign.send", status: "pending" },
    select: { id: true, payloadJson: true },
  });
  for (const job of pending) {
    try {
      const payload = JSON.parse(job.payloadJson) as { campaignId?: string };
      if (payload?.campaignId === campaignId) {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            status: "done",
            lastError: "campaign cancelled",
          },
        });
      }
    } catch {
      // ignore malformed
    }
  }
}

registerJobHandler("campaign.send", async (payload: { campaignId?: string }) => {
  const campaignId = payload?.campaignId;
  if (!campaignId) return;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  if (campaign && campaign.status === "scheduled") {
    enqueueCampaignSend(campaignId);
  }
});

/**
 * After restart: recover stranded recipient claims without blindly re-opening
 * Meta submits that may already have been accepted.
 */
export async function resumeInterruptedCampaigns(): Promise<void> {
  const recovered = await recoverSendingRecipients();
  if (
    recovered.promotedSent > 0 ||
    recovered.indeterminateFailed > 0 ||
    recovered.releasedPending > 0
  ) {
    console.log(
      `[broadcast] Boot recovery promoted=${recovered.promotedSent} indeterminateFailed=${recovered.indeterminateFailed} releasedPending=${recovered.releasedPending}`
    );
  }

  const stuck = await prisma.campaign.findMany({
    where: { status: "sending" },
    select: { id: true },
  });
  for (const c of stuck) {
    console.log(`[broadcast] Re-queue interrupted campaign ${c.id}`);
    enqueueCampaignSend(c.id);
  }
}

export async function updateRecipientStatusByWaId(
  waMessageId: string,
  status: string
): Promise<void> {
  const mapped =
    status === "delivered" || status === "read" || status === "failed"
      ? status
      : status === "sent"
        ? "sent"
        : null;

  if (!mapped) return;

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { waMessageId },
  });
  if (!recipient) return;

  if (!shouldApplyDeliveryStatus(recipient.status, mapped)) {
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { status: mapped },
  });

  emitCampaignProgress({
    campaignId: recipient.campaignId,
    recipientId: recipient.id,
    contactId: recipient.contactId,
    recipientStatus: mapped,
    waMessageId,
    ...(await getProgress(recipient.campaignId)),
  });

  if (mapped === "delivered") {
    void logTimeline({
      contactId: recipient.contactId,
      eventType: TimelineEventType.CAMPAIGN_DELIVERED,
      title: "تسليم حملة",
      actor: actorAutomation("Campaign"),
      metadata: {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        waMessageId,
      },
    });
  }
}

/**
 * Attribute an inbound message as a campaign reply (idempotent).
 * Priority: reply-to waMessageId → latest eligible send within attribution window.
 */
export async function attributeCampaignReply(opts: {
  contactId: string;
  inboundMessageId: string;
  replyToWaMessageId?: string | null;
}): Promise<{ recipientId: string; campaignId: string } | null> {
  const already = await prisma.campaignRecipient.findFirst({
    where: { replyMessageId: opts.inboundMessageId },
    select: { id: true, campaignId: true },
  });
  if (already) {
    return { recipientId: already.id, campaignId: already.campaignId };
  }

  const windowMs = Math.max(1, env.CAMPAIGN_REPLY_WINDOW_HOURS) * 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  const candidates = await prisma.campaignRecipient.findMany({
    where: {
      contactId: opts.contactId,
      repliedAt: null,
      sentAt: { not: null, gte: since },
      status: { in: ["sent", "delivered", "read"] },
    },
    select: { id: true, waMessageId: true, sentAt: true, campaignId: true },
    orderBy: { sentAt: "desc" },
    take: 20,
  });

  const picked = pickReplyRecipient(
    candidates,
    opts.replyToWaMessageId
  );
  if (!picked) return null;

  const full = candidates.find((c) => c.id === picked.id);
  if (!full) return null;

  try {
    const result = await prisma.campaignRecipient.updateMany({
      where: { id: full.id, repliedAt: null },
      data: {
        repliedAt: new Date(),
        replyMessageId: opts.inboundMessageId,
      },
    });
    if (result.count === 0) {
      // Lost race or already attributed
      const again = await prisma.campaignRecipient.findFirst({
        where: { replyMessageId: opts.inboundMessageId },
        select: { id: true, campaignId: true },
      });
      return again
        ? { recipientId: again.id, campaignId: again.campaignId }
        : null;
    }
  } catch (error) {
    // Unique replyMessageId collision from concurrent webhook
    const again = await prisma.campaignRecipient.findFirst({
      where: { replyMessageId: opts.inboundMessageId },
      select: { id: true, campaignId: true },
    });
    if (again) {
      return { recipientId: again.id, campaignId: again.campaignId };
    }
    console.error("[broadcast] attributeCampaignReply error:", error);
    return null;
  }

  emitCampaignProgress({
    campaignId: full.campaignId,
    recipientId: full.id,
    contactId: opts.contactId,
    recipientStatus: "replied",
    ...(await getProgress(full.campaignId)),
  });

  void logTimeline({
    contactId: opts.contactId,
    eventType: TimelineEventType.CAMPAIGN_REPLIED,
    title: "رد على حملة",
    actor: actorAutomation("Campaign"),
    metadata: {
      campaignId: full.campaignId,
      recipientId: full.id,
      messageId: opts.inboundMessageId,
      replyToWaMessageId: opts.replyToWaMessageId ?? null,
    },
  });

  return { recipientId: full.id, campaignId: full.campaignId };
}

/**
 * Reset failed recipients to pending and resume sending (does not re-send successes).
 * Excludes indeterminate Meta-submit crashes marked [NO_AUTO_RETRY].
 */
export async function retryFailedCampaignRecipients(
  campaignId: string
): Promise<{ retried: number }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  if (!campaign) {
    throw new Error("Campaign not found");
  }
  if (campaign.status === "cancelled") {
    throw new Error("Cannot retry a cancelled campaign");
  }

  const failed = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "failed" },
    select: { id: true, errorMessage: true },
  });

  let retried = 0;
  for (const row of failed) {
    if (!isAutoRetryableFailedRecipient(row.errorMessage)) {
      console.log(
        `[broadcast] recipient=${row.id} skipped retry-failed (no-auto-retry)`
      );
      continue;
    }
    const updated = await prisma.campaignRecipient.updateMany({
      where: { id: row.id, status: "failed" },
      data: {
        status: "pending",
        errorMessage: null,
        waMessageId: null,
        sentAt: null,
      },
    });
    if (updated.count === 1) {
      retried += 1;
      console.log(
        `[broadcast] recipient=${row.id} retry-failed → pending (intentional)`
      );
    }
  }

  if (retried === 0) {
    return { retried: 0 };
  }

  if (campaign.status !== "sending") {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending" },
    });
  }

  enqueueCampaignSend(campaignId);
  emitCampaignProgress({
    campaignId,
    status: "sending",
    ...(await getProgress(campaignId)),
  });

  return { retried };
}
