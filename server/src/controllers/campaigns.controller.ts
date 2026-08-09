import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import {
  cancelScheduledCampaignTimer,
  enqueueCampaignSend,
  scheduleCampaignSend,
} from "../services/broadcast.service";
import { emitCampaignProgress } from "../services/socket.service";

async function recipientStats(campaignId: string) {
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
  return { total, counts };
}

export async function listCampaigns(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        template: true,
        contactList: true,
        channel: {
          select: {
            id: true,
            name: true,
            displayName: true,
            phoneNumber: true,
          },
        },
        _count: { select: { recipients: true } },
      },
    });

    const payload = await Promise.all(
      campaigns.map(async (campaign) => {
        const stats = await recipientStats(campaign.id);
        return {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          scheduledAt: campaign.scheduledAt,
          createdAt: campaign.createdAt,
          channelId: campaign.channelId,
          channel: campaign.channel,
          template: {
            id: campaign.template.id,
            name: campaign.template.name,
            status: campaign.template.status,
            bodyText: campaign.template.bodyText,
          },
          contactList: {
            id: campaign.contactList.id,
            name: campaign.contactList.name,
          },
          recipientCount: campaign._count.recipients,
          stats,
        };
      })
    );

    res.json(payload);
  } catch (error) {
    console.error("[campaigns] list error:", error);
    res.status(500).json({ error: "Failed to list campaigns" });
  }
}

export async function getCampaign(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        template: true,
        contactList: true,
        channel: {
          select: {
            id: true,
            name: true,
            displayName: true,
            phoneNumber: true,
          },
        },
        recipients: {
          include: {
            contact: {
              select: {
                id: true,
                phone: true,
                name: true,
                optedOut: true,
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const stats = await recipientStats(campaign.id);

    res.json({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      scheduledAt: campaign.scheduledAt,
      createdAt: campaign.createdAt,
      channelId: campaign.channelId,
      channel: campaign.channel,
      template: campaign.template,
      contactList: {
        id: campaign.contactList.id,
        name: campaign.contactList.name,
      },
      recipients: campaign.recipients,
      stats,
    });
  } catch (error) {
    console.error("[campaigns] get error:", error);
    res.status(500).json({ error: "Failed to get campaign" });
  }
}

export async function createCampaign(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { name, templateId, contactListId, scheduledAt, channelId } =
      req.body as {
        name?: string;
        templateId?: string;
        contactListId?: string;
        scheduledAt?: string | null;
        channelId?: string;
      };

    if (!name?.trim() || !templateId || !contactListId || !channelId?.trim()) {
      res.status(400).json({
        error: "name, templateId, contactListId, and channelId are required",
      });
      return;
    }

    const channel = await prisma.whatsAppChannel.findUnique({
      where: { id: channelId.trim() },
    });
    if (!channel || !channel.isActive) {
      res.status(400).json({
        error: "WhatsApp channel not found or inactive",
      });
      return;
    }

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (template.status !== "approved") {
      res.status(400).json({
        error: "Only approved templates can be used in campaigns",
      });
      return;
    }

    const list = await prisma.contactList.findUnique({
      where: { id: contactListId },
      include: {
        contacts: {
          where: { optedOut: false },
          select: { id: true },
        },
      },
    });
    if (!list) {
      res.status(404).json({ error: "Contact list not found" });
      return;
    }

    if (list.contacts.length === 0) {
      res.status(400).json({
        error: "Contact list has no eligible members (all opted out or empty)",
      });
      return;
    }

    const scheduleDate = scheduledAt ? new Date(scheduledAt) : null;
    const isFuture =
      scheduleDate !== null &&
      !Number.isNaN(scheduleDate.getTime()) &&
      scheduleDate.getTime() > Date.now();

    const campaign = await prisma.campaign.create({
      data: {
        name: name.trim(),
        templateId,
        contactListId,
        channelId: channel.id,
        scheduledAt: isFuture ? scheduleDate : null,
        status: isFuture ? "scheduled" : "draft",
        recipients: {
          create: list.contacts.map((contact) => ({
            contactId: contact.id,
            status: "pending",
          })),
        },
      },
      include: {
        template: true,
        contactList: true,
        _count: { select: { recipients: true } },
      },
    });

    if (isFuture && scheduleDate) {
      scheduleCampaignSend(campaign.id, scheduleDate);
    }

    const stats = await recipientStats(campaign.id);

    res.status(201).json({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      scheduledAt: campaign.scheduledAt,
      createdAt: campaign.createdAt,
      channelId: campaign.channelId,
      template: {
        id: campaign.template.id,
        name: campaign.template.name,
        status: campaign.template.status,
        bodyText: campaign.template.bodyText,
      },
      contactList: {
        id: campaign.contactList.id,
        name: campaign.contactList.name,
      },
      recipientCount: campaign._count.recipients,
      stats,
    });
  } catch (error) {
    console.error("[campaigns] create error:", error);
    res.status(500).json({ error: "Failed to create campaign" });
  }
}

export async function sendCampaign(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (campaign.status === "sending") {
      res.status(400).json({ error: "Campaign is already sending" });
      return;
    }

    if (campaign.status === "completed") {
      res.status(400).json({ error: "Campaign already completed" });
      return;
    }

    if (campaign.template.status !== "approved") {
      res.status(400).json({
        error: "Only approved templates can be sent in campaigns",
      });
      return;
    }

    const pending = await prisma.campaignRecipient.count({
      where: { campaignId: id, status: "pending" },
    });
    if (pending === 0) {
      res.status(400).json({ error: "No pending recipients to send" });
      return;
    }

    await prisma.campaign.update({
      where: { id },
      data: { status: "sending" },
    });

    enqueueCampaignSend(id);

    logAuditFromRequest(req, {
      action: AuditAction.START,
      entityType: AuditEntity.CAMPAIGN,
      entityId: id,
      oldValues: { status: campaign.status },
      newValues: { status: "sending" },
      metadata: { campaignId: id, pending },
    });

    res.json({
      ok: true,
      message: "Campaign queued for batched sending",
      campaignId: id,
      pending,
      batchSize: process.env.BROADCAST_BATCH_SIZE || "20",
      batchDelayMs: process.env.BROADCAST_BATCH_DELAY_MS || "5000",
    });
  } catch (error) {
    console.error("[campaigns] send error:", error);
    res.status(500).json({ error: "Failed to start campaign send" });
  }
}

export async function pauseCampaign(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (campaign.status !== "sending") {
      res
        .status(400)
        .json({ error: "Only campaigns currently sending can be paused" });
      return;
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: "paused" },
    });

    emitCampaignProgress({ campaignId: id, status: "paused" });
    logAuditFromRequest(req, {
      action: AuditAction.STOP,
      entityType: AuditEntity.CAMPAIGN,
      entityId: id,
      oldValues: { status: "sending" },
      newValues: { status: "paused" },
      metadata: { campaignId: id, reason: "paused" },
    });

    res.json({ ok: true, campaign: updated });
  } catch (error) {
    console.error("[campaigns] pause error:", error);
    res.status(500).json({ error: "Failed to pause campaign" });
  }
}

export async function resumeCampaign(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (campaign.status !== "paused") {
      res.status(400).json({ error: "Only paused campaigns can be resumed" });
      return;
    }

    const pending = await prisma.campaignRecipient.count({
      where: { campaignId: id, status: "pending" },
    });

    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: "sending" },
    });

    enqueueCampaignSend(id);

    logAuditFromRequest(req, {
      action: AuditAction.START,
      entityType: AuditEntity.CAMPAIGN,
      entityId: id,
      oldValues: { status: "paused" },
      newValues: { status: "sending" },
      metadata: { campaignId: id, reason: "resumed", pending },
    });

    res.json({ ok: true, campaign: updated, pending });
  } catch (error) {
    console.error("[campaigns] resume error:", error);
    res.status(500).json({ error: "Failed to resume campaign" });
  }
}

export async function cancelCampaign(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (["completed", "cancelled"].includes(campaign.status)) {
      res
        .status(400)
        .json({ error: `Campaign is already ${campaign.status}` });
      return;
    }

    cancelScheduledCampaignTimer(id);

    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: "cancelled" },
    });

    await prisma.campaignRecipient.updateMany({
      where: { campaignId: id, status: "pending" },
      data: { status: "cancelled", errorMessage: "Campaign cancelled" },
    });

    emitCampaignProgress({ campaignId: id, status: "cancelled" });
    logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.CAMPAIGN,
      entityId: id,
      oldValues: { status: campaign.status },
      newValues: { status: "cancelled" },
      metadata: { campaignId: id, reason: "cancelled" },
    });

    res.json({ ok: true, campaign: updated });
  } catch (error) {
    console.error("[campaigns] cancel error:", error);
    res.status(500).json({ error: "Failed to cancel campaign" });
  }
}
