import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSocket,
  type MessageDeletedEvent,
  type MessageStatusEvent,
  type MessageUpdatedEvent,
  type NewMessageEvent,
  type PresenceUpdateEvent,
} from "../hooks/useSocket";
import {
  deleteMessage,
  editMessage,
  formatReplyTime,
  getMessagesPage,
  isApiError,
  markConversationRead,
  mediaSrc,
  messageAvatar,
  messageSenderName,
  normalizeSenderType,
  pinMessage,
  retryMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendMessage,
  senderLabel,
  sendTemplateMessage,
  shouldShowOutboundSender,
  starMessage,
  takeOverConversation,
  type Conversation,
  type InteractiveListSection,
  type Message,
} from "../lib/api";
import { getStoredUser } from "../lib/auth";
import { MESSAGE_STATUS_LABELS, SENDER_TYPE_LABELS, labelOr } from "../lib/uiLabels";
import ConversationHeader, {
  type LastRepliedBy,
} from "./ConversationHeader";
import FlowTestBanner from "./FlowTestBanner";
import MessageInput from "./MessageInput";

function upsertMessage(prev: Message[], next: Message): Message[] {
  const idx = prev.findIndex((m) => m.id === next.id);
  if (idx === -1) return [...prev, next];
  const copy = [...prev];
  copy[idx] = { ...copy[idx], ...next };
  return copy;
}

type Props = {
  conversation: Conversation | null;
  onConversationUpdated: (conversation: Conversation) => void;
  notesOpen?: boolean;
  onToggleNotes?: () => void;
};

function formatMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseMetaPayload(raw?: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function MetaPayloadView({ raw }: { raw?: string | null }) {
  const data = parseMetaPayload(raw);
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const location =
    (obj.location as {
      latitude?: number;
      longitude?: number;
      name?: string;
      address?: string;
    } | undefined) || undefined;
  if (obj.type === "location" || obj.latitude != null || location) {
    const lat = obj.latitude ?? location?.latitude;
    const lng = obj.longitude ?? location?.longitude;
    const name =
      (obj.name as string) || location?.name || location?.address || "موقع";
    return (
      <p className="text-xs text-sky-200">
        📍 {name}
        {lat != null && lng != null ? ` (${String(lat)}, ${String(lng)})` : ""}
      </p>
    );
  }

  if (obj.reaction && typeof obj.reaction === "object") {
    const reaction = obj.reaction as { emoji?: string; message_id?: string };
    return (
      <p className="text-xs text-amber-200">
        تفاعل: {reaction.emoji || "👍"}
      </p>
    );
  }

  if (obj.type === "contacts" || Array.isArray(obj.contacts)) {
    const contacts = (obj.contacts as Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>) || [];
    return (
      <div className="space-y-1 text-xs text-sky-200">
        {contacts.map((c, i) => (
          <p key={i}>
            👤 {c.name?.formatted_name || "جهة اتصال"}
            {c.phones?.[0]?.phone ? ` — ${c.phones[0].phone}` : ""}
          </p>
        ))}
      </div>
    );
  }

  // Outbound interactive buttons stored by our API
  if (
    obj.interactiveType === "buttons" ||
    (obj.bodyText && Array.isArray(obj.buttons))
  ) {
    const bodyText = String(obj.bodyText || "");
    const buttons = (obj.buttons as Array<{ id?: string; title?: string }>) || [];
    return (
      <div className="space-y-2 text-sm">
        {bodyText && (
          <p className="whitespace-pre-wrap break-words leading-6">{bodyText}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {buttons.map((b, i) => (
            <span
              key={b.id || String(i)}
              className="rounded-md border border-white/20 bg-black/20 px-2 py-1 text-xs"
            >
              {b.title || b.id || "زر"}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (obj.interactiveType === "list" || Array.isArray(obj.sections)) {
    const bodyText = String(obj.bodyText || "");
    const buttonLabel = String(obj.buttonLabel || "قائمة");
    const sections =
      (obj.sections as Array<{
        title?: string;
        rows?: Array<{ id?: string; title?: string; description?: string }>;
      }>) || [];
    return (
      <div className="space-y-2 text-sm">
        {bodyText && (
          <p className="whitespace-pre-wrap break-words leading-6">{bodyText}</p>
        )}
        <p className="text-xs text-inbox-muted">زر القائمة: {buttonLabel}</p>
        {sections.map((section, si) => (
          <div key={si} className="rounded border border-white/10 bg-black/15 px-2 py-1.5">
            <p className="text-xs font-medium">{section.title || "قسم"}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-inbox-muted">
              {(section.rows || []).map((row, ri) => (
                <li key={row.id || String(ri)}>
                  {row.title || row.id}
                  {row.description ? ` — ${row.description}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  // Inbound button / list reply
  const interactive = obj.interactive as
    | {
        type?: string;
        button_reply?: { title?: string; id?: string };
        list_reply?: { title?: string; id?: string };
      }
    | undefined;
  if (interactive?.button_reply || interactive?.list_reply) {
    const reply = interactive.button_reply || interactive.list_reply;
    return (
      <p className="text-sm">
        اختيار: <span className="font-medium">{reply?.title || reply?.id}</span>
      </p>
    );
  }

  return (
    <p className="break-all text-[10px] leading-4 text-inbox-muted">
      {JSON.stringify(obj).slice(0, 160)}
    </p>
  );
}

function looksLikeJsonObject(value: string): boolean {
  const t = value.trim();
  return t.startsWith("{") && t.endsWith("}");
}

function MessageBody({ message }: { message: Message }) {
  const src = mediaSrc(message.mediaUrl);
  const caption = message.caption || "";

  if (message.type === "image" && src) {
    return (
      <div className="space-y-1">
        <a href={src} target="_blank" rel="noreferrer">
          <img
            src={src}
            alt={caption || "صورة"}
            className="max-h-64 max-w-full rounded-md object-contain"
          />
        </a>
        {caption && (
          <p className="whitespace-pre-wrap break-words text-sm">{caption}</p>
        )}
      </div>
    );
  }

  if (message.type === "video" && src) {
    return (
      <div className="space-y-1">
        <video src={src} controls className="max-h-64 max-w-full rounded-md" />
        {caption && (
          <p className="whitespace-pre-wrap break-words text-sm">{caption}</p>
        )}
      </div>
    );
  }

  if (message.type === "audio" && src) {
    return <audio src={src} controls className="max-w-full" />;
  }

  if (message.type === "document" && src) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 text-sm underline"
      >
        <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px]">
          ملف
        </span>
        <span>{message.content || "مستند"}</span>
      </a>
    );
  }

  // Some interactive outbound messages store JSON in content
  if (message.content && looksLikeJsonObject(message.content)) {
    const parsed = parseMetaPayload(message.content);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (
        obj.interactiveType === "buttons" ||
        obj.bodyText ||
        obj.interactive
      ) {
        return <MetaPayloadView raw={message.content} />;
      }
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      {message.content && (
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {message.content}
        </p>
      )}
      {message.editedAt && (
        <p className="text-[10px] text-inbox-muted">تم التعديل</p>
      )}
      <MetaPayloadView raw={message.metaPayload} />
    </div>
  );
}

function playBeep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // ignore audio errors
  }
}

export default function ChatWindow({
  conversation,
  onConversationUpdated,
  notesOpen = true,
  onToggleNotes,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [presence, setPresence] = useState<PresenceUpdateEvent | null>(null);
  const [takeOverBusy, setTakeOverBusy] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [messageFilter, setMessageFilter] = useState<"all" | "pinned" | "starred">(
    "all"
  );
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const contactId = conversation?.contactId ?? null;
  const conversationId = conversation?.id ?? null;

  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const visibleMessages = useMemo(() => {
    if (messageFilter === "pinned") return messages.filter((m) => m.pinned);
    if (messageFilter === "starred") return messages.filter((m) => m.starred);
    return messages;
  }, [messages, messageFilter]);

  const lockStaleMs = 15 * 60 * 1000;
  const lockActive = Boolean(
    conversation?.lockedById &&
      conversation.lockedAt &&
      Date.now() - new Date(conversation.lockedAt).getTime() <= lockStaleMs
  );
  const lockedByOther = Boolean(
    lockActive &&
      conversation?.lockedById &&
      conversation.lockedById !== getStoredUser()?.id
  );

  const lastInboundAt = useMemo(() => {
    const inbound = [...messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    return inbound?.createdAt ?? null;
  }, [messages]);

  const lastRepliedBy = useMemo((): LastRepliedBy => {
    const outbound = [...messages]
      .reverse()
      .find(
        (m) =>
          m.direction === "outbound" &&
          m.status !== "failed" &&
          !m.deletedAt
      );
    if (!outbound) {
      const lm = conversation?.contact.lastMessage;
      if (
        lm?.direction === "outbound" &&
        lm.status !== "failed"
      ) {
        const name =
          lm.senderName?.trim() ||
          lm.createdByName?.trim() ||
          (lm.sentByAi ? "Bot" : "");
        if (!name) return null;
        return {
          name,
          senderType: lm.senderType,
          at: lm.createdAt,
        };
      }
      return null;
    }
    return {
      name: senderLabel(outbound),
      senderType: normalizeSenderType(
        outbound.senderType,
        outbound.sentByAi
      ),
      at: outbound.createdAt,
    };
  }, [messages, conversation?.contact.lastMessage]);

  const onUpdatedRef = useRef(onConversationUpdated);
  onUpdatedRef.current = onConversationUpdated;

  const handleNewMessage = useCallback(
    (payload: NewMessageEvent) => {
      if (!contactId || payload.message.contactId !== contactId) return;
      setMessages((prev) => upsertMessage(prev, payload.message));
    },
    [contactId]
  );

  const handleMessageStatus = useCallback(
    (payload: MessageStatusEvent) => {
      if (!contactId) return;
      if (payload.contactId && payload.contactId !== contactId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.waMessageId === payload.waMessageId
            ? { ...m, status: payload.status }
            : m
        )
      );
    },
    [contactId]
  );

  const handleMessageUpdated = useCallback(
    (payload: MessageUpdatedEvent) => {
      if (!contactId || payload.message.contactId !== contactId) return;
      setMessages((prev) => upsertMessage(prev, payload.message));
    },
    [contactId]
  );

  const handleMessageDeleted = useCallback(
    (payload: MessageDeletedEvent) => {
      if (!contactId || payload.contactId !== contactId) return;
      setMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
      setEditingId((id) => (id === payload.messageId ? null : id));
      setReplyTo((m) => (m?.id === payload.messageId ? null : m));
      setDetailsId((id) => (id === payload.messageId ? null : id));
    },
    [contactId]
  );

  const handlePresenceUpdate = useCallback(
    (payload: PresenceUpdateEvent) => {
      if (!conversationId || payload.conversationId !== conversationId) return;
      setPresence(payload);
    },
    [conversationId]
  );

  const { viewConversation, unview, typingStart, typingStop } = useSocket({
    onNewMessage: handleNewMessage,
    onMessageStatus: handleMessageStatus,
    onMessageUpdated: handleMessageUpdated,
    onMessageDeleted: handleMessageDeleted,
    onPresenceUpdate: handlePresenceUpdate,
  });

  useEffect(() => {
    if (!contactId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const page = await getMessagesPage(contactId!, { limit: 100 });
        if (!cancelled) setMessages(page.items);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "فشل تحميل الرسائل");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  useEffect(() => {
    if (!conversationId) {
      setReplyTo(null);
      setPresence(null);
      return;
    }

    viewConversation(conversationId);
    void markConversationRead(conversationId)
      .then((updated) => onUpdatedRef.current(updated))
      .catch(() => {
        // ignore mark-read errors
      });

    return () => {
      unview(conversationId);
    };
  }, [conversationId, viewConversation, unview]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  function applyOutboundResult(saved: Message) {
    setMessages((prev) => upsertMessage(prev, saved));
  }

  function handleOutboundError(err: unknown, fallback: string) {
    if (isApiError(err) && err.messagePayload) {
      applyOutboundResult(err.messagePayload);
    }
    setError(err instanceof Error ? err.message : fallback);
  }

  function startEdit(message: Message) {
    if (message.type !== "text" || message.direction !== "outbound") return;
    setEditingId(message.id);
    setEditDraft(message.content || "");
    setDetailsId(null);
  }

  async function saveEdit(messageId: string) {
    const content = editDraft.trim();
    if (!content) {
      setError("نص الرسالة مطلوب");
      return;
    }
    setActionBusy(messageId);
    setError(null);
    try {
      const saved = await editMessage(messageId, content);
      setMessages((prev) => upsertMessage(prev, saved));
      setEditingId(null);
      setEditDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تعديل الرسالة");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(messageId: string) {
    if (
      !window.confirm(
        "حذف الرسالة من صندوق Kadina فقط؟\nلن تُحذف من واتساب لدى العميل."
      )
    ) {
      return;
    }
    setActionBusy(messageId);
    setError(null);
    try {
      await deleteMessage(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setEditingId((id) => (id === messageId ? null : id));
      setReplyTo((m) => (m?.id === messageId ? null : m));
      setDetailsId((id) => (id === messageId ? null : id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل حذف الرسالة");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSend(text: string, replyToMessageId?: string) {
    if (!contactId) return;
    setError(null);
    try {
      const saved = await sendMessage(contactId, text, replyToMessageId);
      applyOutboundResult(saved);
      setReplyTo(null);
    } catch (err) {
      handleOutboundError(err, "فشل إرسال الرسالة");
      throw err;
    }
  }

  async function handleSendMedia(file: File, caption?: string) {
    if (!contactId) return;
    setError(null);
    try {
      const saved = await sendMediaMessage(contactId, file, caption);
      applyOutboundResult(saved);
    } catch (err) {
      handleOutboundError(err, "فشل إرسال الوسائط");
      throw err;
    }
  }

  async function handleSendInteractiveButtons(
    bodyText: string,
    buttons: Array<{ id: string; title: string }>
  ) {
    if (!contactId) return;
    setError(null);
    try {
      const saved = await sendInteractiveButtons(contactId, bodyText, buttons);
      applyOutboundResult(saved);
    } catch (err) {
      handleOutboundError(err, "فشل إرسال الرسالة التفاعلية");
      throw err;
    }
  }

  async function handleSendInteractiveList(
    bodyText: string,
    buttonLabel: string,
    sections: InteractiveListSection[]
  ) {
    if (!contactId) return;
    setError(null);
    try {
      const saved = await sendInteractiveList(
        contactId,
        bodyText,
        buttonLabel,
        sections
      );
      applyOutboundResult(saved);
    } catch (err) {
      handleOutboundError(err, "فشل إرسال القائمة التفاعلية");
      throw err;
    }
  }

  async function handlePinToggle(message: Message) {
    setActionBusy(message.id);
    setError(null);
    try {
      const saved = await pinMessage(message.id, !message.pinned);
      setMessages((prev) => upsertMessage(prev, saved));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تثبيت الرسالة");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleStarToggle(message: Message) {
    setActionBusy(message.id);
    setError(null);
    try {
      const saved = await starMessage(message.id, !message.starred);
      setMessages((prev) => upsertMessage(prev, saved));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تمييز الرسالة");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSendTemplate(templateId: string, params: string[]) {
    if (!contactId) return;
    setError(null);
    try {
      const saved = await sendTemplateMessage(contactId, templateId, params);
      applyOutboundResult(saved);
    } catch (err) {
      handleOutboundError(err, "فشل إرسال القالب");
      throw err;
    }
  }

  async function handleRetry(messageId: string) {
    setError(null);
    try {
      const saved = await retryMessage(messageId);
      applyOutboundResult(saved);
    } catch (err) {
      handleOutboundError(err, "فشل إعادة الإرسال");
    }
  }

  async function handleTakeOver() {
    if (!conversationId) return;
    setTakeOverBusy(true);
    setError(null);
    try {
      const updated = await takeOverConversation(conversationId);
      onConversationUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الاستلام");
    } finally {
      setTakeOverBusy(false);
    }
  }

  if (!conversation) {
    return (
      <section className="flex h-full min-h-0 min-w-0 items-center justify-center bg-inbox-bg">
        <p className="text-inbox-muted">اختر محادثة لعرض الرسائل</p>
      </section>
    );
  }

  const typingNames =
    presence?.typing?.map((u) => u.name).filter(Boolean) ?? [];
  const viewerNames =
    presence?.viewers?.map((u) => u.name).filter(Boolean) ?? [];

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#0b141a]">
      <div className="shrink-0">
        <ConversationHeader
          conversation={conversation}
          onUpdated={onConversationUpdated}
          lastRepliedBy={lastRepliedBy}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-inbox-border bg-inbox-panel/80 px-4 py-1.5 text-xs text-inbox-muted">
        <p className="min-w-0 truncate">
          {typingNames.length > 0
            ? `يكتب: ${typingNames.join("، ")}`
            : viewerNames.length > 0
              ? `يشاهدون: ${viewerNames.join("، ")}`
              : "لا يوجد نشاط حالي"}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {onToggleNotes && (
            <button
              type="button"
              onClick={onToggleNotes}
              className="rounded-md bg-inbox-hover px-3 py-1 text-xs text-inbox-text hover:bg-inbox-border"
            >
              {notesOpen ? "إخفاء الملاحظات" : "الملاحظات / CRM"}
            </button>
          )}
          {(getStoredUser()?.role === "admin" ||
            conversation.assignedToId === getStoredUser()?.id) && (
            <button
              type="button"
              disabled={takeOverBusy}
              onClick={() => void handleTakeOver()}
              className="rounded-md bg-inbox-accent px-3 py-1 text-xs text-white disabled:opacity-50"
            >
              {takeOverBusy ? "..." : "استلام المحادثة"}
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <FlowTestBanner contactId={contactId} />
      </div>

      {lockedByOther && (
        <div className="shrink-0 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-200">
          المحادثة مقفلة بواسطة{" "}
          {conversation.lockedBy?.name || "موظف آخر"} — يمكنك المشاهدة فقط حتى
          يُفتح القفل.
        </div>
      )}

      <div className="flex shrink-0 gap-1 border-b border-inbox-border px-4 py-2">
        {(
          [
            ["all", "كل الرسائل"],
            ["pinned", "مثبّتة"],
            ["starred", "مميزة"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMessageFilter(key)}
            className={`rounded-md px-2.5 py-1 text-[11px] ${
              messageFilter === key
                ? "bg-inbox-accent text-white"
                : "bg-inbox-hover text-inbox-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="scroll-panel min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-4 py-4"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.02), transparent 40%), radial-gradient(circle at 80% 0%, rgba(0,168,132,0.05), transparent 35%)",
        }}
      >
        {loading && (
          <p className="text-sm text-inbox-muted">جاري تحميل الرسائل...</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && visibleMessages.length === 0 && (
          <p className="text-sm text-inbox-muted">
            {messageFilter === "all"
              ? "لا توجد رسائل بعد."
              : "لا توجد رسائل مطابقة لهذا الفلتر."}
          </p>
        )}

        {visibleMessages.map((message) => {
          const index = messages.findIndex((m) => m.id === message.id);
          const outbound = message.direction === "outbound";
          const src = mediaSrc(message.mediaUrl);
          const replySource = message.replyToMessageId
            ? messagesById.get(message.replyToMessageId)
            : null;
          const showSender = shouldShowOutboundSender(messages, Math.max(0, index));
          const label = senderLabel(message);
          const senderType = normalizeSenderType(
            message.senderType,
            message.sentByAi
          );
          const avatar = messageAvatar(message);
          const isBotLike =
            senderType === "BOT" ||
            senderType === "AI" ||
            senderType === "AUTOMATION" ||
            senderType === "SYSTEM" ||
            (!!message.sentByAi && !message.createdByUserId);
          const showDetails = detailsId === message.id;
          const isEditing = editingId === message.id;
          const canEdit =
            outbound && message.type === "text" && !message.deletedAt;
          const busy = actionBusy === message.id;
          return (
            <div
              key={message.id}
              className={`group flex ${outbound ? "justify-start" : "justify-end"}`}
            >
              <div className="relative max-w-[min(75%,36rem)] min-w-0">
                {outbound && showSender && (
                  <div className="mb-0.5 flex items-center gap-1.5 px-1">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt=""
                        className="h-4 w-4 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                          isBotLike
                            ? "bg-sky-500/30 text-sky-100"
                            : "bg-inbox-accent/30 text-inbox-accent"
                        }`}
                      >
                        {isBotLike
                          ? senderType === "AI"
                            ? "✨"
                            : "🤖"
                          : (label.slice(0, 1) || "?").toUpperCase()}
                      </span>
                    )}
                    <p
                      className={`truncate text-[11px] font-medium ${
                        isBotLike ? "text-sky-200" : "text-inbox-accent"
                      }`}
                    >
                      {label}
                    </p>
                  </div>
                )}

              {isEditing ? (
                <div
                  className={`w-full min-w-0 space-y-2 overflow-hidden rounded-lg px-3 py-2 shadow-sm ${
                    outbound
                      ? "rounded-tr-sm bg-inbox-outbound"
                      : "rounded-tl-sm bg-inbox-inbound"
                  }`}
                >
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={3}
                    disabled={busy}
                    className="w-full resize-y rounded-md border border-inbox-border bg-black/20 px-2 py-1.5 text-sm text-inbox-text outline-none focus:border-inbox-accent"
                    dir="auto"
                  />
                  <p className="text-[10px] text-inbox-muted">
                    التعديل يظهر في Kadina فقط — لن يتغيّر على واتساب لدى العميل.
                  </p>
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setEditDraft("");
                      }}
                      className="rounded-md bg-inbox-hover px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      disabled={busy || !editDraft.trim()}
                      onClick={() => void saveEdit(message.id)}
                      className="rounded-md bg-inbox-accent px-2 py-1 text-[11px] text-white disabled:opacity-50"
                    >
                      {busy ? "..." : "حفظ"}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`w-full min-w-0 overflow-hidden rounded-lg shadow-sm ${
                    outbound
                      ? "rounded-tr-sm bg-inbox-outbound"
                      : "rounded-tl-sm bg-inbox-inbound"
                  } ${replyTo?.id === message.id ? "ring-1 ring-inbox-accent" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTo(message);
                      setDetailsId((id) =>
                        id === message.id ? null : message.id
                      );
                    }}
                    className="w-full px-3 py-2 text-right"
                  >
                    {replySource && (
                      <div className="mb-1 rounded border-r-2 border-inbox-accent/60 bg-black/20 px-2 py-1 text-[11px] text-inbox-muted">
                        <p className="truncate">
                          {replySource.content || replySource.type}
                        </p>
                      </div>
                    )}
                    <div
                      onClick={(e) => {
                        if (message.type === "image" && src) {
                          e.stopPropagation();
                          setLightbox(src);
                        }
                      }}
                      className={
                        message.type === "image" && src
                          ? "cursor-zoom-in"
                          : undefined
                      }
                    >
                      <MessageBody message={message} />
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-inbox-muted">
                      <span dir="ltr">{formatMessageTime(message.createdAt)}</span>
                      {outbound && (
                        <span
                          className={
                            message.status === "failed"
                              ? "font-medium text-red-300"
                              : undefined
                          }
                        >
                          {labelOr(MESSAGE_STATUS_LABELS, message.status)}
                        </span>
                      )}
                    </div>
                    {message.status === "failed" && (
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-red-300">
                        <span className="min-w-0 truncate">
                          {message.errorMessage || "فشل الإرسال"}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRetry(message.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleRetry(message.id);
                            }
                          }}
                          className="shrink-0 cursor-pointer rounded bg-red-500/30 px-2 py-0.5 hover:bg-red-500/40"
                        >
                          إعادة المحاولة
                        </span>
                      </div>
                    )}
                  </button>

                  <div className="flex flex-wrap items-center justify-start gap-2 border-t border-black/10 px-2 py-1.5">
                    {canEdit && (
                      <button
                        type="button"
                        disabled={busy}
                        title="تعديل في الصندوق فقط"
                        onClick={() => startEdit(message)}
                        className="rounded-md bg-black/15 px-2 py-1 text-[11px] text-inbox-text hover:bg-black/25 disabled:opacity-50"
                      >
                        تعديل
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      title={message.pinned ? "إلغاء التثبيت" : "تثبيت"}
                      onClick={() => void handlePinToggle(message)}
                      className={`rounded-md px-2 py-1 text-[11px] disabled:opacity-50 ${
                        message.pinned
                          ? "bg-amber-500/30 text-amber-100"
                          : "bg-black/15 text-inbox-text hover:bg-black/25"
                      }`}
                    >
                      {message.pinned ? "مثبّتة" : "تثبيت"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title={message.starred ? "إلغاء التمييز" : "تمييز"}
                      onClick={() => void handleStarToggle(message)}
                      className={`rounded-md px-2 py-1 text-[11px] disabled:opacity-50 ${
                        message.starred
                          ? "bg-yellow-500/30 text-yellow-100"
                          : "bg-black/15 text-inbox-text hover:bg-black/25"
                      }`}
                    >
                      {message.starred ? "مميزة ★" : "تمييز"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title="حذف من الصندوق فقط"
                      onClick={() => void handleDelete(message.id)}
                      className="rounded-md bg-red-500/20 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/30 disabled:opacity-50"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              )}
              {showDetails && outbound && !isEditing && (
                <div className="absolute top-full z-20 mt-1 w-56 rounded-lg border border-inbox-border bg-inbox-panel p-2 text-[11px] text-inbox-muted shadow-lg">
                  <p>
                    <span className="text-inbox-text">أُرسلت بواسطة:</span>{" "}
                    {messageSenderName(message) || label}
                  </p>
                  <p>
                    <span className="text-inbox-text">الدور:</span>{" "}
                    {message.senderRole ||
                      message.createdByRole ||
                      "—"}
                  </p>
                  <p>
                    <span className="text-inbox-text">نوع المرسل:</span>{" "}
                    {senderType
                      ? labelOr(SENDER_TYPE_LABELS, senderType)
                      : "—"}
                  </p>
                  <p>
                    <span className="text-inbox-text">الوقت:</span>{" "}
                    <span dir="ltr">{formatReplyTime(message.createdAt)}</span>
                  </p>
                  <p>
                    <span className="text-inbox-text">معدّلة:</span>{" "}
                    {message.editedAt ? "نعم" : "لا"}
                  </p>
                  <p>
                    <span className="text-inbox-text">محذوفة:</span>{" "}
                    {message.deletedAt ? "نعم" : "لا"}
                  </p>
                </div>
              )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-inbox-border bg-inbox-panel">
        <MessageInput
          disabled={lockedByOther}
          lastInboundAt={lastInboundAt}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          onTypingStart={() => {
            if (conversationId) typingStart(conversationId);
          }}
          onTypingStop={() => {
            if (conversationId) typingStop(conversationId);
          }}
          onSend={handleSend}
          onSendMedia={handleSendMedia}
          onSendTemplate={handleSendTemplate}
          onSendInteractiveButtons={handleSendInteractiveButtons}
          onSendInteractiveList={handleSendInteractiveList}
        />
      </div>

      {lightbox && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="تكبير"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      )}
    </section>
  );
}

export { playBeep };
