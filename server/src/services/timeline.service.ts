import { prisma } from "../lib/prisma";
import type { AuthUser } from "../middleware/auth";
import { emitTimelineEvent } from "./socket.service";

/** Actor performing the event */
export type TimelineActorType =
  | "ADMIN"
  | "AGENT"
  | "AI"
  | "BOT"
  | "SYSTEM"
  | "AUTOMATION"
  | "CUSTOMER";

/** Extensible event taxonomy */
export const TimelineEventType = {
  MESSAGE_SENT: "MESSAGE_SENT",
  MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
  MESSAGE_READ: "MESSAGE_READ",
  MESSAGE_FAILED: "MESSAGE_FAILED",
  MESSAGE_RETRIED: "MESSAGE_RETRIED",
  NOTE_CREATED: "NOTE_CREATED",
  NOTE_UPDATED: "NOTE_UPDATED",
  NOTE_DELETED: "NOTE_DELETED",
  TAG_ADDED: "TAG_ADDED",
  TAG_REMOVED: "TAG_REMOVED",
  CRM_UPDATED: "CRM_UPDATED",
  CONTACT_CREATED: "CONTACT_CREATED",
  CONTACT_UPDATED: "CONTACT_UPDATED",
  CONVERSATION_OPENED: "CONVERSATION_OPENED",
  CONVERSATION_CLOSED: "CONVERSATION_CLOSED",
  CONVERSATION_REOPENED: "CONVERSATION_REOPENED",
  CONVERSATION_ASSIGNED: "CONVERSATION_ASSIGNED",
  CONVERSATION_TRANSFERRED: "CONVERSATION_TRANSFERRED",
  ASSIGNMENT_CREATED: "ASSIGNMENT_CREATED",
  ASSIGNMENT_CHANGED: "ASSIGNMENT_CHANGED",
  ASSIGNMENT_REMOVED: "ASSIGNMENT_REMOVED",
  CONVERSATION_LOCKED: "CONVERSATION_LOCKED",
  CONVERSATION_UNLOCKED: "CONVERSATION_UNLOCKED",
  APPOINTMENT_CREATED: "APPOINTMENT_CREATED",
  APPOINTMENT_UPDATED: "APPOINTMENT_UPDATED",
  APPOINTMENT_CANCELLED: "APPOINTMENT_CANCELLED",
  CAMPAIGN_SENT: "CAMPAIGN_SENT",
  CAMPAIGN_DELIVERED: "CAMPAIGN_DELIVERED",
  CAMPAIGN_FAILED: "CAMPAIGN_FAILED",
  FLOW_STARTED: "FLOW_STARTED",
  FLOW_COMPLETED: "FLOW_COMPLETED",
  WELCOME_SENT: "WELCOME_SENT",
  AWAY_SENT: "AWAY_SENT",
} as const;

export type TimelineEventTypeName =
  (typeof TimelineEventType)[keyof typeof TimelineEventType];

/** Filter groups for API / UI */
export const TIMELINE_FILTER_GROUPS: Record<string, string[]> = {
  messages: [
    TimelineEventType.MESSAGE_SENT,
    TimelineEventType.MESSAGE_RECEIVED,
    TimelineEventType.MESSAGE_READ,
    TimelineEventType.MESSAGE_FAILED,
    TimelineEventType.MESSAGE_RETRIED,
  ],
  crm: [
    TimelineEventType.CRM_UPDATED,
    TimelineEventType.CONTACT_CREATED,
    TimelineEventType.CONTACT_UPDATED,
    TimelineEventType.TAG_ADDED,
    TimelineEventType.TAG_REMOVED,
  ],
  appointments: [
    TimelineEventType.APPOINTMENT_CREATED,
    TimelineEventType.APPOINTMENT_UPDATED,
    TimelineEventType.APPOINTMENT_CANCELLED,
  ],
  campaigns: [
    TimelineEventType.CAMPAIGN_SENT,
    TimelineEventType.CAMPAIGN_DELIVERED,
    TimelineEventType.CAMPAIGN_FAILED,
  ],
  automation: [
    TimelineEventType.FLOW_STARTED,
    TimelineEventType.FLOW_COMPLETED,
    TimelineEventType.WELCOME_SENT,
    TimelineEventType.AWAY_SENT,
  ],
  ai: [], // matched by actorType AI
  notes: [
    TimelineEventType.NOTE_CREATED,
    TimelineEventType.NOTE_UPDATED,
    TimelineEventType.NOTE_DELETED,
  ],
  system: [
    TimelineEventType.CONVERSATION_OPENED,
    TimelineEventType.CONVERSATION_CLOSED,
    TimelineEventType.CONVERSATION_REOPENED,
    TimelineEventType.CONVERSATION_ASSIGNED,
    TimelineEventType.CONVERSATION_TRANSFERRED,
    TimelineEventType.ASSIGNMENT_CREATED,
    TimelineEventType.ASSIGNMENT_CHANGED,
    TimelineEventType.ASSIGNMENT_REMOVED,
    TimelineEventType.CONVERSATION_LOCKED,
    TimelineEventType.CONVERSATION_UNLOCKED,
  ],
};

export type TimelineActor = {
  performedByUserId?: string | null;
  performedByName?: string | null;
  performedByRole?: string | null;
  actorType: TimelineActorType;
};

export type LogTimelineInput = {
  contactId: string;
  conversationId?: string | null;
  eventType: TimelineEventTypeName | string;
  title: string;
  description?: string | null;
  actor: TimelineActor;
  metadata?: Record<string, unknown> | null;
};

export function actorFromUser(user?: AuthUser | null): TimelineActor {
  if (!user) {
    return {
      performedByUserId: null,
      performedByName: "System",
      performedByRole: "system",
      actorType: "SYSTEM",
    };
  }
  const isAdmin = user.role === "admin";
  return {
    performedByUserId: user.id,
    performedByName: user.name,
    performedByRole: isAdmin ? "admin" : "agent",
    actorType: isAdmin ? "ADMIN" : "AGENT",
  };
}

export function actorCustomer(name?: string | null): TimelineActor {
  return {
    performedByUserId: null,
    performedByName: name || "Customer",
    performedByRole: "customer",
    actorType: "CUSTOMER",
  };
}

export function actorSystem(name = "System"): TimelineActor {
  return {
    performedByUserId: null,
    performedByName: name,
    performedByRole: "system",
    actorType: "SYSTEM",
  };
}

export function actorBot(name = "Bot"): TimelineActor {
  return {
    performedByUserId: null,
    performedByName: name,
    performedByRole: "bot",
    actorType: "BOT",
  };
}

export function actorAi(name = "AI"): TimelineActor {
  return {
    performedByUserId: null,
    performedByName: name,
    performedByRole: "ai",
    actorType: "AI",
  };
}

export function actorAutomation(name = "Automation"): TimelineActor {
  return {
    performedByUserId: null,
    performedByName: name,
    performedByRole: "automation",
    actorType: "AUTOMATION",
  };
}

/**
 * Fire-and-forget timeline writer. Never throws to callers.
 * Emits socket `timeline_event` for realtime UI.
 */
export async function logTimeline(input: LogTimelineInput): Promise<void> {
  try {
    const event = await prisma.timelineEvent.create({
      data: {
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        eventType: input.eventType,
        title: input.title,
        description: input.description ?? null,
        performedByUserId: input.actor.performedByUserId ?? null,
        performedByName: input.actor.performedByName ?? null,
        performedByRole: input.actor.performedByRole ?? null,
        actorType: input.actor.actorType,
        metadata:
          input.metadata === undefined || input.metadata === null
            ? null
            : JSON.stringify(input.metadata),
      },
    });

    emitTimelineEvent({
      id: event.id,
      contactId: event.contactId,
      conversationId: event.conversationId,
      eventType: event.eventType,
      title: event.title,
      description: event.description,
      performedByUserId: event.performedByUserId,
      performedByName: event.performedByName,
      performedByRole: event.performedByRole,
      actorType: event.actorType,
      metadata: input.metadata ?? null,
      createdAt: event.createdAt,
    });
  } catch (error) {
    console.error("[timeline] Failed to write event:", error);
  }
}

export type ListTimelineQuery = {
  contactId: string;
  cursor?: string | null;
  limit?: number;
  search?: string | null;
  filter?: string | null;
};

export async function listTimelineEvents(query: ListTimelineQuery) {
  const take = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const where: {
    contactId: string;
    eventType?: { in: string[] };
    actorType?: string;
    OR?: Array<
      | { title: { contains: string; mode: "insensitive" } }
      | { description: { contains: string; mode: "insensitive" } }
      | { performedByName: { contains: string; mode: "insensitive" } }
    >;
  } = { contactId: query.contactId };

  const filter = (query.filter || "all").toLowerCase();
  if (filter === "ai") {
    where.actorType = "AI";
  } else if (filter !== "all" && TIMELINE_FILTER_GROUPS[filter]) {
    where.eventType = { in: TIMELINE_FILTER_GROUPS[filter] };
  }

  const q = query.search?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { performedByName: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.timelineEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(query.cursor
      ? { cursor: { id: query.cursor }, skip: 1 }
      : {}),
  });

  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return {
    items: items.map((e) => ({
      id: e.id,
      contactId: e.contactId,
      conversationId: e.conversationId,
      eventType: e.eventType,
      title: e.title,
      description: e.description,
      performedByUserId: e.performedByUserId,
      performedByName: e.performedByName,
      performedByRole: e.performedByRole,
      actorType: e.actorType,
      metadata: e.metadata
        ? (JSON.parse(e.metadata) as unknown)
        : null,
      createdAt: e.createdAt,
    })),
    nextCursor,
  };
}
