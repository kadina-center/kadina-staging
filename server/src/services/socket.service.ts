import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import { env } from "../config/env";
import {
  resolveAuthUserFromJwt,
  type AuthUser,
} from "../middleware/auth";
import { prisma } from "../lib/prisma";
import {
  canAccessConversation,
  getConversationAccessCached,
} from "./conversation-access.service";

let io: Server | null = null;

type PresenceUser = { id: string; name: string };
const typingByConversation = new Map<string, Map<string, PresenceUser>>();
const viewingByConversation = new Map<string, Map<string, PresenceUser>>();

export type NewMessagePayload = {
  message: {
    id: string;
    contactId: string;
    direction: string;
    type: string;
    content: string;
    status: string;
    waMessageId: string | null;
    mediaUrl?: string | null;
    mediaMimeType?: string | null;
    caption?: string | null;
    sentByAi?: boolean;
    createdByUserId?: string | null;
    createdByName?: string | null;
    createdByRole?: string | null;
    createdByAvatar?: string | null;
    senderType?: string | null;
    senderUserId?: string | null;
    senderName?: string | null;
    senderRole?: string | null;
    senderAvatar?: string | null;
    replyToMessageId?: string | null;
    replyToWaMessageId?: string | null;
    metaPayload?: string | null;
    errorMessage?: string | null;
    deletedAt?: Date | string | null;
    editedAt?: Date | string | null;
    createdAt: Date | string;
  };
  contact: {
    id: string;
    phone: string;
    name: string | null;
    lastMessageAt?: Date | string;
  };
  channelId?: string | null;
};

function adminRoom(): string {
  return "role:admin";
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/**
 * Emit to admins + assigned agent only.
 * Unassigned conversations → admins only.
 */
export function emitToConversationAudience(
  assignedToId: string | null | undefined,
  event: string,
  payload: unknown,
  extraUserIds: string[] = []
): void {
  if (!io) return;
  io.to(adminRoom()).emit(event, payload);
  const seen = new Set<string>();
  if (assignedToId) {
    io.to(userRoom(assignedToId)).emit(event, payload);
    seen.add(assignedToId);
  }
  for (const id of extraUserIds) {
    if (!id || seen.has(id)) continue;
    io.to(userRoom(id)).emit(event, payload);
    seen.add(id);
  }
}

async function resolveAssigneeByContact(
  contactId: string
): Promise<string | null> {
  const conv = await prisma.conversation.findUnique({
    where: { contactId },
    select: { assignedToId: true },
  });
  return conv?.assignedToId ?? null;
}

async function resolveAssigneeByConversation(
  conversationId: string
): Promise<string | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { assignedToId: true },
  });
  return conv?.assignedToId ?? null;
}

function emitPresence(conversationId: string, assignedToId: string | null) {
  if (!io) return;
  const typing = [...(typingByConversation.get(conversationId)?.values() || [])];
  const viewers = [
    ...(viewingByConversation.get(conversationId)?.values() || []),
  ];
  emitToConversationAudience(assignedToId, "presence_update", {
    conversationId,
    typing,
    viewers,
  });
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    void (async () => {
      try {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) {
          next(new Error("Authentication required"));
          return;
        }
        const user = await resolveAuthUserFromJwt(token);
        if (!user) {
          next(new Error("Invalid token"));
          return;
        }
        socket.data.user = user;
        next();
      } catch {
        next(new Error("Invalid token"));
      }
    })();
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as AuthUser;
    void socket.join(userRoom(user.id));
    if (user.role === "admin") {
      void socket.join(adminRoom());
    }
    console.log(`[socket] ${user.name} connected: ${socket.id}`);

    socket.on("conversation:view", (conversationId: string) => {
      void (async () => {
        if (!conversationId) return;
        const conv = await getConversationAccessCached(conversationId);
        if (!canAccessConversation(user, conv)) return;
        if (!viewingByConversation.has(conversationId)) {
          viewingByConversation.set(conversationId, new Map());
        }
        viewingByConversation
          .get(conversationId)!
          .set(user.id, { id: user.id, name: user.name });
        emitPresence(conversationId, conv!.assignedToId);
      })();
    });

    socket.on("conversation:unview", (conversationId: string) => {
      void (async () => {
        viewingByConversation.get(conversationId)?.delete(user.id);
        typingByConversation.get(conversationId)?.delete(user.id);
        const conv = await getConversationAccessCached(conversationId);
        emitPresence(conversationId, conv?.assignedToId ?? null);
      })();
    });

    socket.on(
      "typing:start",
      (payload: { conversationId?: string } | string) => {
        void (async () => {
          const conversationId =
            typeof payload === "string" ? payload : payload.conversationId;
          if (!conversationId) return;
          const conv = await getConversationAccessCached(conversationId);
          if (!canAccessConversation(user, conv)) return;
          if (!typingByConversation.has(conversationId)) {
            typingByConversation.set(conversationId, new Map());
          }
          typingByConversation
            .get(conversationId)!
            .set(user.id, { id: user.id, name: user.name });
          emitPresence(conversationId, conv!.assignedToId);
        })();
      }
    );

    socket.on(
      "typing:stop",
      (payload: { conversationId?: string } | string) => {
        void (async () => {
          const conversationId =
            typeof payload === "string" ? payload : payload.conversationId;
          if (!conversationId) return;
          typingByConversation.get(conversationId)?.delete(user.id);
          const conv = await getConversationAccessCached(conversationId);
          emitPresence(conversationId, conv?.assignedToId ?? null);
        })();
      }
    );

    socket.on("disconnect", () => {
      const touched = new Set<string>();
      for (const [conversationId, map] of viewingByConversation) {
        if (map.delete(user.id)) touched.add(conversationId);
      }
      for (const [conversationId, map] of typingByConversation) {
        if (map.delete(user.id)) touched.add(conversationId);
      }
      for (const conversationId of touched) {
        void resolveAssigneeByConversation(conversationId).then((assignee) => {
          emitPresence(conversationId, assignee);
        });
      }
      console.log(`[socket] ${user.name} disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.io has not been initialized. Call initSocket first.");
  }
  return io;
}

/** Disconnect clients and close the Socket.IO server (idempotent if never started). */
export function closeSocket(): Promise<void> {
  if (!io) return Promise.resolve();
  const current = io;
  io = null;
  typingByConversation.clear();
  viewingByConversation.clear();
  return new Promise((resolve, reject) => {
    current.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function emitNewMessage(
  payload: NewMessagePayload,
  assignedToId?: string | null
): void {
  if (!io) return;
  if (assignedToId !== undefined) {
    emitToConversationAudience(assignedToId, "new_message", payload);
    return;
  }
  void resolveAssigneeByContact(payload.contact.id).then((assignee) => {
    emitToConversationAudience(assignee, "new_message", payload);
  });
}

export function emitMessageStatus(payload: {
  waMessageId: string;
  status: string;
  contactId?: string;
  assignedToId?: string | null;
}): void {
  if (!io) return;
  if (payload.assignedToId !== undefined) {
    emitToConversationAudience(payload.assignedToId, "message_status", payload);
    return;
  }
  if (payload.contactId) {
    void resolveAssigneeByContact(payload.contactId).then((assignee) => {
      emitToConversationAudience(assignee, "message_status", payload);
    });
    return;
  }
  // No contact context — admins only (avoid leaking to all agents)
  io.to(adminRoom()).emit("message_status", payload);
}

/** Local inbox edit (not synced to WhatsApp). */
export function emitMessageUpdated(
  payload: { message: NewMessagePayload["message"] & { contactId: string } },
  assignedToId?: string | null
): void {
  if (!io) return;
  if (assignedToId !== undefined) {
    emitToConversationAudience(assignedToId, "message_updated", payload);
    return;
  }
  void resolveAssigneeByContact(payload.message.contactId).then((assignee) => {
    emitToConversationAudience(assignee, "message_updated", payload);
  });
}

/** Local soft-delete (not synced to WhatsApp). */
export function emitMessageDeleted(
  payload: { messageId: string; contactId: string },
  assignedToId?: string | null
): void {
  if (!io) return;
  if (assignedToId !== undefined) {
    emitToConversationAudience(assignedToId, "message_deleted", payload);
    return;
  }
  void resolveAssigneeByContact(payload.contactId).then((assignee) => {
    emitToConversationAudience(assignee, "message_deleted", payload);
  });
}

export function emitConversationUpdated(
  // Callers pass full conversation payloads; only assignee fields are used for room routing.
  payload: {
    assignedToId?: string | null;
    id?: string;
    [key: string]: unknown;
  },
  previousAssignedToId?: string | null
): void {
  if (!io) return;
  const assignee =
    payload.assignedToId !== undefined ? payload.assignedToId : null;
  const extras: string[] = [];
  if (
    previousAssignedToId &&
    previousAssignedToId !== assignee
  ) {
    extras.push(previousAssignedToId);
  }
  emitToConversationAudience(
    assignee,
    "conversation_updated",
    payload,
    extras
  );
}

export function emitNoteAdded(
  payload: { conversationId?: string },
  assignedToId?: string | null
): void {
  if (!io) return;
  if (assignedToId !== undefined) {
    emitToConversationAudience(assignedToId, "note_added", payload);
    return;
  }
  if (payload.conversationId) {
    void resolveAssigneeByConversation(payload.conversationId).then(
      (assignee) => {
        emitToConversationAudience(assignee, "note_added", payload);
      }
    );
    return;
  }
  io.to(adminRoom()).emit("note_added", payload);
}

export type CampaignProgressPayload = {
  campaignId: string;
  status?: string;
  recipientId?: string;
  contactId?: string;
  recipientStatus?: string;
  waMessageId?: string;
  error?: string;
  total?: number;
  processed?: number;
  counts?: Record<string, number>;
  funnel?: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    replied: number;
  };
  rates?: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    replied: number;
  };
};

export function emitCampaignProgress(payload: CampaignProgressPayload): void {
  if (!io) return;
  // Campaign progress may include recipient/contact ids — admins only.
  // Handshake already requires JWT before any room join (see initSocket io.use).
  io.to(adminRoom()).emit("campaign_progress", payload);
}

export type TimelineEventPayload = {
  id: string;
  contactId: string;
  conversationId: string | null;
  eventType: string;
  title: string;
  description: string | null;
  performedByUserId: string | null;
  performedByName: string | null;
  performedByRole: string | null;
  actorType: string;
  metadata: unknown;
  createdAt: Date | string;
};

export function emitTimelineEvent(payload: TimelineEventPayload): void {
  if (!io) return;
  if (payload.conversationId) {
    void resolveAssigneeByConversation(payload.conversationId).then(
      (assignee) => {
        emitToConversationAudience(assignee, "timeline_event", payload);
      }
    );
    return;
  }
  void resolveAssigneeByContact(payload.contactId).then((assignee) => {
    emitToConversationAudience(assignee, "timeline_event", payload);
  });
}

export type AuditEventPayload = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  performedByUserId: string | null;
  performedByName: string | null;
  performedByRole: string | null;
  actorType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  status: string;
  oldValues: unknown;
  newValues: unknown;
  metadata: unknown;
  createdAt: Date | string;
};

export function emitAuditEvent(payload: AuditEventPayload): void {
  if (!io) return;
  io.to(adminRoom()).emit("audit_event", payload);
}
