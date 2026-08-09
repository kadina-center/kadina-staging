import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  CampaignProgressEvent,
  Contact,
  Conversation,
  Message,
  Note,
} from "../lib/api";
import { getToken } from "../lib/api";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:4000";

export type NewMessageEvent = {
  message: Message;
  contact: Pick<Contact, "id" | "phone" | "name"> & {
    lastMessageAt?: string;
  };
};

export type MessageStatusEvent = {
  waMessageId: string;
  status: string;
  contactId?: string;
};

export type ConversationUpdatedEvent = Conversation;

export type NoteAddedEvent = Note;

export type PresenceUser = { id: string; name: string };

export type PresenceUpdateEvent = {
  conversationId: string;
  typing: PresenceUser[];
  viewers: PresenceUser[];
};

export type TimelineEventSocket = {
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
  createdAt: string | Date;
};

export type AuditEventSocket = {
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
  createdAt: string | Date;
};

type UseSocketOptions = {
  onNewMessage?: (payload: NewMessageEvent) => void;
  onMessageStatus?: (payload: MessageStatusEvent) => void;
  onConversationUpdated?: (payload: ConversationUpdatedEvent) => void;
  onNoteAdded?: (payload: NoteAddedEvent) => void;
  onCampaignProgress?: (payload: CampaignProgressEvent) => void;
  onPresenceUpdate?: (payload: PresenceUpdateEvent) => void;
  onTimelineEvent?: (payload: TimelineEventSocket) => void;
  onAuditEvent?: (payload: AuditEventSocket) => void;
};

type HandlerBag = {
  onNewMessage?: (payload: NewMessageEvent) => void;
  onMessageStatus?: (payload: MessageStatusEvent) => void;
  onConversationUpdated?: (payload: ConversationUpdatedEvent) => void;
  onNoteAdded?: (payload: NoteAddedEvent) => void;
  onCampaignProgress?: (payload: CampaignProgressEvent) => void;
  onPresenceUpdate?: (payload: PresenceUpdateEvent) => void;
  onTimelineEvent?: (payload: TimelineEventSocket) => void;
  onAuditEvent?: (payload: AuditEventSocket) => void;
};

/** Single shared Socket.IO connection for the whole app session. */
let sharedSocket: Socket | null = null;
let sharedToken: string | null = null;
let refCount = 0;
const subscribers = new Set<() => HandlerBag>();
const connectedListeners = new Set<(connected: boolean) => void>();

function broadcastConnected(connected: boolean) {
  connectedListeners.forEach((fn) => fn(connected));
}

function ensureSharedSocket(token: string): Socket {
  if (sharedSocket && sharedToken === token) {
    return sharedSocket;
  }

  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }

  sharedToken = token;
  const socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    autoConnect: true,
    auth: { token },
  });
  sharedSocket = socket;

  socket.on("connect", () => broadcastConnected(true));
  socket.on("disconnect", () => broadcastConnected(false));

  socket.on("new_message", (payload: NewMessageEvent) => {
    subscribers.forEach((get) => get().onNewMessage?.(payload));
  });
  socket.on("message_status", (payload: MessageStatusEvent) => {
    subscribers.forEach((get) => get().onMessageStatus?.(payload));
  });
  socket.on("conversation_updated", (payload: ConversationUpdatedEvent) => {
    subscribers.forEach((get) => get().onConversationUpdated?.(payload));
  });
  socket.on("note_added", (payload: NoteAddedEvent) => {
    subscribers.forEach((get) => get().onNoteAdded?.(payload));
  });
  socket.on("campaign_progress", (payload: CampaignProgressEvent) => {
    subscribers.forEach((get) => get().onCampaignProgress?.(payload));
  });
  socket.on("presence_update", (payload: PresenceUpdateEvent) => {
    subscribers.forEach((get) => get().onPresenceUpdate?.(payload));
  });
  socket.on("timeline_event", (payload: TimelineEventSocket) => {
    subscribers.forEach((get) => get().onTimelineEvent?.(payload));
  });
  socket.on("audit_event", (payload: AuditEventSocket) => {
    subscribers.forEach((get) => get().onAuditEvent?.(payload));
  });

  return socket;
}

function releaseSharedSocket() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    sharedToken = null;
    broadcastConnected(false);
  }
}

export function useSocket(options: UseSocketOptions = {}) {
  const [lastMessage, setLastMessage] = useState<NewMessageEvent | null>(null);
  const [connected, setConnected] = useState(
    () => Boolean(sharedSocket?.connected)
  );

  const handlersRef = useRef<HandlerBag>({});
  handlersRef.current = {
    onNewMessage: (payload) => {
      setLastMessage(payload);
      options.onNewMessage?.(payload);
    },
    onMessageStatus: options.onMessageStatus,
    onConversationUpdated: options.onConversationUpdated,
    onNoteAdded: options.onNoteAdded,
    onCampaignProgress: options.onCampaignProgress,
    onPresenceUpdate: options.onPresenceUpdate,
    onTimelineEvent: options.onTimelineEvent,
    onAuditEvent: options.onAuditEvent,
  };

  const token = getToken();

  useEffect(() => {
    const getHandlers = () => handlersRef.current;
    subscribers.add(getHandlers);
    connectedListeners.add(setConnected);

    if (!token) {
      setConnected(false);
      return () => {
        subscribers.delete(getHandlers);
        connectedListeners.delete(setConnected);
      };
    }

    refCount += 1;
    const socket = ensureSharedSocket(token);
    setConnected(socket.connected);

    return () => {
      subscribers.delete(getHandlers);
      connectedListeners.delete(setConnected);
      releaseSharedSocket();
    };
  }, [token]);

  const viewConversation = useCallback((conversationId: string) => {
    sharedSocket?.emit("conversation:view", conversationId);
  }, []);

  const unview = useCallback((conversationId: string) => {
    sharedSocket?.emit("conversation:unview", conversationId);
  }, []);

  const typingStart = useCallback((conversationId: string) => {
    sharedSocket?.emit("typing:start", { conversationId });
  }, []);

  const typingStop = useCallback((conversationId: string) => {
    sharedSocket?.emit("typing:stop", { conversationId });
  }, []);

  return {
    lastMessage,
    connected,
    socket: sharedSocket,
    viewConversation,
    unview,
    typingStart,
    typingStop,
  };
}
