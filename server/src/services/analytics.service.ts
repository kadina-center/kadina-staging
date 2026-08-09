import { prisma } from "../lib/prisma";

export type DateRange = {
  from?: Date;
  to?: Date;
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  );
  const end = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  );
  while (cursor <= end) {
    days.push(dayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function resolveRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: start, to: end };
}

function conversationCreatedFilter(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return {
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

export async function getConversationStats(from?: Date, to?: Date) {
  const range = resolveRange(from, to);
  const where = conversationCreatedFilter(range.from, range.to);

  const byStatus = await prisma.conversation.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });

  const statusCounts = { open: 0, pending: 0, closed: 0, total: 0 };
  for (const row of byStatus) {
    const key = row.status as keyof typeof statusCounts;
    if (key in statusCounts && key !== "total") {
      statusCounts[key] = row._count._all;
    }
    statusCounts.total += row._count._all;
  }

  // Currently open (regardless of createdAt range) for live KPI
  const currentlyOpen = await prisma.conversation.count({
    where: { status: "open" },
  });

  const created = await prisma.conversation.findMany({
    where,
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const dailyMap = new Map<string, number>();
  for (const day of eachDay(range.from, range.to)) {
    dailyMap.set(day, 0);
  }
  for (const c of created) {
    const key = dayKey(c.createdAt);
    dailyMap.set(key, (dailyMap.get(key) || 0) + 1);
  }

  return {
    statusCounts,
    currentlyOpen,
    newConversationsDaily: [...dailyMap.entries()].map(([date, count]) => ({
      date,
      count,
    })),
  };
}

export async function getResponseTimeStats(from?: Date, to?: Date) {
  const range = resolveRange(from, to);

  const conversations = await prisma.conversation.findMany({
    where: {
      firstResponseAt: { not: null },
      createdAt: { gte: range.from, lte: range.to },
    },
    select: {
      id: true,
      contactId: true,
      assignedToId: true,
      firstResponseAt: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });

  const contactIds = conversations.map((c) => c.contactId);
  const firstInbounds =
    contactIds.length === 0
      ? []
      : await prisma.message.findMany({
          where: {
            contactId: { in: contactIds },
            direction: "inbound",
          },
          orderBy: { createdAt: "asc" },
          distinct: ["contactId"],
          select: { contactId: true, createdAt: true },
        });

  const firstInboundMap = new Map(
    firstInbounds.map((m) => [m.contactId, m.createdAt])
  );

  const minutesList: number[] = [];
  const byAgent = new Map<
    string,
    { userId: string; name: string; minutes: number[] }
  >();

  for (const conv of conversations) {
    if (!conv.firstResponseAt) continue;
    const firstInboundAt = firstInboundMap.get(conv.contactId);
    if (!firstInboundAt) continue;

    const mins =
      (conv.firstResponseAt.getTime() - firstInboundAt.getTime()) / 60000;
    if (mins < 0) continue;

    minutesList.push(mins);

    const agentId = conv.assignedToId || "unassigned";
    const agentName = conv.assignedTo?.name || "غير معيّن";
    const bucket = byAgent.get(agentId) || {
      userId: agentId,
      name: agentName,
      minutes: [],
    };
    bucket.minutes.push(mins);
    byAgent.set(agentId, bucket);
  }

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    averageMinutes: avg(minutesList),
    sampleSize: minutesList.length,
    byAgent: [...byAgent.values()].map((a) => ({
      userId: a.userId,
      name: a.name,
      averageMinutes: avg(a.minutes),
      sampleSize: a.minutes.length,
    })),
  };
}

export async function getMessageVolumeStats(from?: Date, to?: Date) {
  const range = resolveRange(from, to);

  const messages = await prisma.message.findMany({
    where: {
      createdAt: { gte: range.from, lte: range.to },
    },
    select: {
      createdAt: true,
      direction: true,
      sentByAi: true,
    },
  });

  const dailyMap = new Map<string, { inbound: number; outbound: number }>();
  for (const day of eachDay(range.from, range.to)) {
    dailyMap.set(day, { inbound: 0, outbound: 0 });
  }

  let outboundHuman = 0;
  let outboundAi = 0;
  let inbound = 0;

  for (const m of messages) {
    const key = dayKey(m.createdAt);
    const bucket = dailyMap.get(key) || { inbound: 0, outbound: 0 };
    if (m.direction === "inbound") {
      bucket.inbound += 1;
      inbound += 1;
    } else {
      bucket.outbound += 1;
      if (m.sentByAi) outboundAi += 1;
      else outboundHuman += 1;
    }
    dailyMap.set(key, bucket);
  }

  const outboundTotal = outboundHuman + outboundAi;

  return {
    daily: [...dailyMap.entries()].map(([date, counts]) => ({
      date,
      ...counts,
    })),
    totals: {
      inbound,
      outbound: outboundTotal,
      outboundHuman,
      outboundAi,
      aiOutboundRatio: outboundTotal ? outboundAi / outboundTotal : 0,
    },
  };
}

export async function getTeamPerformanceStats(from?: Date, to?: Date) {
  const range = resolveRange(from, to);
  const response = await getResponseTimeStats(range.from, range.to);

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const handled = await prisma.conversation.groupBy({
    by: ["assignedToId"],
    where: {
      assignedToId: { not: null },
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: { _all: true },
  });

  const closed = await prisma.conversation.groupBy({
    by: ["assignedToId"],
    where: {
      assignedToId: { not: null },
      status: "closed",
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: { _all: true },
  });

  const handledMap = new Map(
    handled.map((h) => [h.assignedToId || "", h._count._all])
  );
  const closedMap = new Map(
    closed.map((c) => [c.assignedToId || "", c._count._all])
  );
  const responseMap = new Map(
    response.byAgent.map((a) => [a.userId, a.averageMinutes])
  );

  return users.map((user) => ({
    userId: user.id,
    name: user.name,
    email: user.email,
    conversationsHandled: handledMap.get(user.id) || 0,
    conversationsClosed: closedMap.get(user.id) || 0,
    averageResponseMinutes: responseMap.get(user.id) ?? null,
  }));
}

export async function getCampaignPerformanceStats(campaignId?: string) {
  const campaigns = await prisma.campaign.findMany({
    where: campaignId ? { id: campaignId } : undefined,
    include: {
      template: { select: { id: true, name: true } },
      recipients: {
        select: { status: true, errorMessage: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return campaigns.map((campaign) => {
    const counts = {
      pending: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
    };
    const errorReasons = new Map<string, number>();

    for (const r of campaign.recipients) {
      const key = r.status as keyof typeof counts;
      if (key in counts) counts[key] += 1;
      if (r.status === "failed" && r.errorMessage) {
        errorReasons.set(
          r.errorMessage,
          (errorReasons.get(r.errorMessage) || 0) + 1
        );
      }
    }

    const total = campaign.recipients.length;
    const sentLike = counts.sent + counts.delivered + counts.read;
    const deliveredLike = counts.delivered + counts.read;

    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      template: campaign.template,
      total,
      counts,
      deliveryRate: sentLike ? deliveredLike / sentLike : 0,
      readRate: deliveredLike ? counts.read / deliveredLike : 0,
      failureRate: total ? counts.failed / total : 0,
      topFailureReasons: [...errorReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    };
  });
}

export async function getTagDistribution(from?: Date, to?: Date) {
  const range = resolveRange(from, to);

  const tags = await prisma.tag.findMany({
    include: {
      conversations: {
        where: {
          createdAt: { gte: range.from, lte: range.to },
        },
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return tags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      count: tag.conversations.length,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function getAnalyticsOverview(from?: Date, to?: Date) {
  const range = resolveRange(from, to);
  const [
    conversations,
    responseTime,
    messageVolume,
    team,
    campaigns,
    tags,
  ] = await Promise.all([
    getConversationStats(range.from, range.to),
    getResponseTimeStats(range.from, range.to),
    getMessageVolumeStats(range.from, range.to),
    getTeamPerformanceStats(range.from, range.to),
    getCampaignPerformanceStats(),
    getTagDistribution(range.from, range.to),
  ]);

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    conversations,
    responseTime,
    messageVolume,
    team,
    campaigns,
    tags,
    kpis: {
      totalConversations: conversations.statusCounts.total,
      currentlyOpen: conversations.currentlyOpen,
      averageResponseMinutes: responseTime.averageMinutes,
      aiOutboundRatio: messageVolume.totals.aiOutboundRatio,
    },
  };
}

export async function exportConversationsCsv(from?: Date, to?: Date) {
  const range = resolveRange(from, to);
  const conversations = await prisma.conversation.findMany({
    where: {
      createdAt: { gte: range.from, lte: range.to },
    },
    include: {
      contact: { select: { phone: true, name: true } },
      assignedTo: { select: { name: true, email: true } },
      tags: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const header = [
    "id",
    "status",
    "contact_phone",
    "contact_name",
    "assigned_to",
    "tags",
    "created_at",
    "last_message_at",
    "first_response_at",
  ];

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const rows = conversations.map((c) =>
    [
      c.id,
      c.status,
      c.contact.phone,
      c.contact.name || "",
      c.assignedTo?.name || "",
      c.tags.map((t) => t.name).join("|"),
      c.createdAt.toISOString(),
      c.lastMessageAt.toISOString(),
      c.firstResponseAt?.toISOString() || "",
    ]
      .map((v) => escape(String(v)))
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}
