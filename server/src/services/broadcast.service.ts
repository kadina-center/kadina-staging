import { env } from "../config/env";
import { prisma } from "../lib/prisma";
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
 * Simple in-app broadcast queue.
 * Processes one campaign at a time in batches to respect Meta rate limits.
 * Can later be swapped for Redis/Bull without changing controllers much.
 */

type QueueJob = {
  campaignId: string;
};

const queue: QueueJob[] = [];
let processing = false;
const activeCampaignIds = new Set<string>();
const scheduledTimers = new Map<string, NodeJS.Timeout>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getProgress(campaignId: string) {
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
  };

  let total = 0;
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    total += row._count._all;
  }

  const processed =
    counts.sent + counts.delivered + counts.read + counts.failed;

  return { total, processed, counts };
}

async function processCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, channel: true },
  });

  if (!campaign) return;

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
    // Re-check status each batch so pause()/cancel() can interrupt a run in
    // progress without losing already-sent recipients.
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

      try {
        const { waMessageId } = await sendTemplateMessage(
          recipient.contact.phone,
          campaign.template.name,
          campaign.template.language,
          [],
          campaign.channelId
        );

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "sent",
            waMessageId,
            sentAt: new Date(),
            errorMessage: null,
          },
        });

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
        const errorMessage =
          error instanceof Error ? error.message : "Send failed";

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
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

    // Rate-limit pause between batches (skip if no more pending)
    const remaining = await prisma.campaignRecipient.count({
      where: { campaignId, status: "pending" },
    });
    if (remaining > 0) {
      await sleep(delayMs);
    }
  }

  if (interrupted) {
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

  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const timer = setTimeout(() => {
    scheduledTimers.delete(campaignId);
    enqueueCampaignSend(campaignId);
  }, delay);

  scheduledTimers.set(campaignId, timer);

  // Durable fallback: if the process restarts before `delay` elapses, the
  // in-memory timer is lost. The ScheduledJob poller will still pick this up.
  void enqueueScheduledJob("campaign.send", scheduledAt, { campaignId });
}

/** Cancels an in-memory scheduled send timer (used when a campaign is cancelled before it fires). */
export function cancelScheduledCampaignTimer(campaignId: string): void {
  const existing = scheduledTimers.get(campaignId);
  if (existing) {
    clearTimeout(existing);
    scheduledTimers.delete(campaignId);
  }
}

registerJobHandler("campaign.send", async (payload: { campaignId?: string }) => {
  const campaignId = payload?.campaignId;
  if (!campaignId) return;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  // Only fire if still scheduled — it may have already been sent, cancelled,
  // or paused by the time this durable job runs.
  if (campaign && campaign.status === "scheduled") {
    enqueueCampaignSend(campaignId);
  }
});

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
