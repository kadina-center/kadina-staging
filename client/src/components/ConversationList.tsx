import { useCallback, useEffect, useState, type MouseEvent } from "react";
import {
  useSocket,
  type ConversationUpdatedEvent,
} from "../hooks/useSocket";
import {
  archiveConversation,
  formatMessagePreview,
  getConversationsPage,
  getTags,
  getUsers,
  getWhatsAppChannelsPublic,
  pinConversation,
  type Conversation,
  type Tag,
  type User,
  type WhatsAppChannelSummary,
} from "../lib/api";
import { getStoredUser } from "../lib/auth";
import { CONVERSATION_STATUS_LABELS, labelOr } from "../lib/uiLabels";

type StatusFilter = "all" | "open" | "pending" | "closed";
type ChannelFilter = "all" | "whatsapp" | "instagram" | "messenger";
/** Admin-only assignment filter */
type AssignFilter = "all" | "unassigned" | "me" | string;

type Props = {
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
};

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "open", label: "مفتوحة" },
  { key: "pending", label: "معلقة" },
  { key: "closed", label: "مغلقة" },
];

const CHANNEL_FILTERS: { key: ChannelFilter; label: string }[] = [
  { key: "all", label: "كل القنوات" },
  { key: "whatsapp", label: "واتساب" },
  { key: "instagram", label: "انستغرام" },
  { key: "messenger", label: "ماسنجر" },
];

function formatTime(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChannelIcon({ channel }: { channel?: string }) {
  const c = channel || "whatsapp";
  if (c === "instagram") {
    return (
      <span
        title="انستغرام"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-[8px] font-bold text-white"
        aria-label="instagram"
      >
        IG
      </span>
    );
  }
  if (c === "messenger") {
    return (
      <span
        title="ماسنجر"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0084FF] text-[8px] font-bold text-white"
        aria-label="messenger"
      >
        M
      </span>
    );
  }
  return (
    <span
      title="واتساب"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-[8px] font-bold text-white"
      aria-label="whatsapp"
    >
      W
    </span>
  );
}

export default function ConversationList({ selectedId, onSelect }: Props) {
  const me = getStoredUser();
  const isAdmin = me?.role === "admin";
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [whatsappChannelId, setWhatsappChannelId] = useState<string>("all");
  const [whatsappChannels, setWhatsappChannels] = useState<
    WhatsAppChannelSummary[]
  >([]);
  const [assignFilter, setAssignFilter] = useState<AssignFilter>("all");
  const [agents, setAgents] = useState<User[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void getUsers()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [isAdmin]);

  useEffect(() => {
    void getTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  useEffect(() => {
    void getWhatsAppChannelsPublic()
      .then(setWhatsappChannels)
      .catch(() => setWhatsappChannels([]));
  }, []);

  function whatsappChannelQuery(): { channelId?: string } {
    if (whatsappChannelId === "all") return {};
    return { channelId: whatsappChannelId };
  }

  function assignQuery(): { assignedToId?: string } {
    if (!isAdmin) return {};
    if (assignFilter === "all") return {};
    if (assignFilter === "unassigned") return { assignedToId: "null" };
    if (assignFilter === "me" && me?.id) return { assignedToId: me.id };
    return { assignedToId: assignFilter };
  }

  function listFilters(extra?: { cursor?: string }) {
    return {
      ...(filter === "all" ? {} : { status: filter }),
      ...(channelFilter === "all" ? {} : { channel: channelFilter }),
      ...whatsappChannelQuery(),
      ...assignQuery(),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(tagFilter ? { tag: tagFilter } : {}),
      archived: showArchived ? "true" : "false",
      limit: 50,
      ...extra,
    } as const;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadConversations = useCallback(async () => {
    try {
      setError(null);
      const page = await getConversationsPage({ ...listFilters() });
      setConversations(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل المحادثات");
    } finally {
      setLoading(false);
    }
  }, [filter, channelFilter, whatsappChannelId, assignFilter, debouncedSearch, tagFilter, showArchived, isAdmin, me?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        setError(null);
        const page = await getConversationsPage({ ...listFilters() });
        if (!cancelled) {
          setConversations(page.items);
          setNextCursor(page.nextCursor);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "فشل تحميل المحادثات");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, channelFilter, whatsappChannelId, assignFilter, debouncedSearch, tagFilter, showArchived, isAdmin, me?.id]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getConversationsPage({
        ...listFilters({ cursor: nextCursor }),
      });
      setConversations((prev) => {
        const ids = new Set(prev.map((c) => c.id));
        return [...prev, ...page.items.filter((c) => !ids.has(c.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل المزيد");
    } finally {
      setLoadingMore(false);
    }
  }

  const handleConversationUpdated = useCallback(
    (payload: ConversationUpdatedEvent) => {
      setConversations((prev) => {
        const user = getStoredUser();
        const without = prev.filter((c) => c.id !== payload.id);

        // Agent lost assignment → drop from inbox immediately
        if (
          user?.role === "agent" &&
          payload.assignedToId !== user.id
        ) {
          return without;
        }

        const matchesStatus = filter === "all" || payload.status === filter;
        const payloadChannel = payload.contact?.channel || "whatsapp";
        const matchesChannel =
          channelFilter === "all" || payloadChannel === channelFilter;
        const matchesWaChannel =
          whatsappChannelId === "all" ||
          payload.channelId === whatsappChannelId;
        const matchesArchived = showArchived
          ? Boolean(payload.archived)
          : !payload.archived;
        const matchesSearch =
          !debouncedSearch ||
          (payload.contact?.name || "")
            .toLowerCase()
            .includes(debouncedSearch.toLowerCase()) ||
          (payload.contact?.phone || "").includes(debouncedSearch);

        let matchesAssign = true;
        if (isAdmin) {
          if (assignFilter === "unassigned") {
            matchesAssign = !payload.assignedToId;
          } else if (assignFilter === "me") {
            matchesAssign = payload.assignedToId === user?.id;
          } else if (assignFilter !== "all") {
            matchesAssign = payload.assignedToId === assignFilter;
          }
        }

        const matchesTag =
          !tagFilter ||
          (payload.tags || []).some(
            (t) => t.id === tagFilter || t.name === tagFilter
          );

        if (
          !matchesStatus ||
          !matchesChannel ||
          !matchesWaChannel ||
          !matchesArchived ||
          !matchesSearch ||
          !matchesAssign ||
          !matchesTag
        ) {
          return without;
        }

        return [payload, ...without].sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) {
            return a.pinned ? -1 : 1;
          }
          return (
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime()
          );
        });
      });
    },
    [filter, channelFilter, whatsappChannelId, showArchived, debouncedSearch, assignFilter, tagFilter, isAdmin]
  );

  const { connected } = useSocket({
    onConversationUpdated: handleConversationUpdated,
  });

  async function handlePin(conversation: Conversation, event: MouseEvent) {
    event.stopPropagation();
    setActionBusy(conversation.id);
    try {
      const updated = await pinConversation(
        conversation.id,
        !conversation.pinned
      );
      handleConversationUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التثبيت");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleArchive(
    conversation: Conversation,
    event: MouseEvent
  ) {
    event.stopPropagation();
    setActionBusy(conversation.id);
    try {
      const updated = await archiveConversation(
        conversation.id,
        !conversation.archived
      );
      handleConversationUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الأرشفة");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-l border-inbox-border bg-inbox-panel">
      <header className="shrink-0 border-b border-inbox-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">وارد الفريق</h1>
            <p className="text-xs text-inbox-muted">
              {connected ? "متصل مباشرة" : "غير متصل"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadConversations()}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-sm text-inbox-text hover:bg-inbox-border"
          >
            تحديث
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو الرقم..."
          dir="rtl"
          className="mt-3 w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                filter === item.key
                  ? "bg-inbox-accent text-white"
                  : "bg-inbox-hover text-inbox-muted hover:text-inbox-text"
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={`rounded-md px-2.5 py-1 text-xs transition ${
              showArchived
                ? "bg-amber-600 text-white"
                : "bg-inbox-hover text-inbox-muted hover:text-inbox-text"
            }`}
          >
            مؤرشف
          </button>
        </div>

        {isAdmin && (
          <div className="mt-2">
            <select
              value={assignFilter}
              onChange={(e) => setAssignFilter(e.target.value)}
              className="w-full rounded-md bg-inbox-hover px-2 py-1.5 text-xs text-inbox-text outline-none"
            >
              <option value="all">التعيين: الكل</option>
              <option value="unassigned">غير معيّن</option>
              <option value="me">معيّن لي</option>
              {agents.map((u) => (
                <option key={u.id} value={u.id}>
                  معيّن إلى {u.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-2 flex gap-1.5">
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="min-w-0 flex-1 rounded-md bg-inbox-hover px-2 py-1.5 text-xs text-inbox-text outline-none"
          >
            <option value="">الوسم: الكل</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {tagFilter ? (
            <button
              type="button"
              onClick={() => setTagFilter("")}
              className="shrink-0 rounded-md bg-inbox-hover px-2 py-1.5 text-xs text-inbox-muted hover:text-inbox-text"
            >
              إزالة
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {CHANNEL_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setChannelFilter(item.key)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                channelFilter === item.key
                  ? "bg-inbox-border text-inbox-text"
                  : "bg-inbox-hover/60 text-inbox-muted hover:text-inbox-text"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {whatsappChannels.length > 0 && (
          <div className="mt-2">
            <select
              value={whatsappChannelId}
              onChange={(e) => setWhatsappChannelId(e.target.value)}
              className="w-full rounded-md bg-inbox-hover px-2 py-1.5 text-xs text-inbox-text outline-none"
            >
              <option value="all">كل أرقام واتساب</option>
              {whatsappChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.displayName || ch.phoneNumber}
                  {!ch.isActive ? " (معطّل)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <div className="scroll-panel min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {loading && (
          <p className="p-4 text-sm text-inbox-muted">جاري التحميل...</p>
        )}
        {error && <p className="p-4 text-sm text-red-400">{error}</p>}
        {!loading && !error && conversations.length === 0 && (
          <p className="p-4 text-sm text-inbox-muted">لا توجد محادثات بعد</p>
        )}

        <ul>
          {conversations.map((conversation) => {
            const active = conversation.id === selectedId;
            const contact = conversation.contact;
            const unread = conversation.unreadCount ?? 0;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation)}
                  className={`flex w-full items-start gap-3 border-b border-inbox-border px-4 py-3 text-right transition ${
                    active ? "bg-inbox-hover" : "hover:bg-inbox-hover/70"
                  }`}
                >
                  <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-inbox-accent/20 text-sm font-semibold text-inbox-accent">
                    {(contact.name || contact.phone).slice(0, 1)}
                    <span className="absolute -bottom-0.5 -left-0.5">
                      <ChannelIcon channel={contact.channel} />
                    </span>
                    {unread > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-inbox-accent px-1 text-[10px] text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1 truncate font-medium">
                        {conversation.pinned && (
                          <span title="مثبّت" className="text-amber-400">
                            📌
                          </span>
                        )}
                        <span className="truncate">
                          {contact.name || contact.phone}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-inbox-muted">
                        {formatTime(
                          contact.lastMessage?.createdAt ||
                            conversation.lastMessageAt
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-inbox-muted">
                      {formatMessagePreview(
                        contact.lastMessage,
                        contact.phone
                      )}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="rounded bg-inbox-border/80 px-1.5 py-0.5 text-[10px] text-inbox-muted">
                        {labelOr(CONVERSATION_STATUS_LABELS, conversation.status)}
                      </span>
                      {conversation.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full px-1.5 py-0.5 text-[10px] text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                      <span className="mr-auto flex gap-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => void handlePin(conversation, e)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              void pinConversation(
                                conversation.id,
                                !conversation.pinned
                              )
                                .then(handleConversationUpdated)
                                .catch((err) =>
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "فشل التثبيت"
                                  )
                                );
                            }
                          }}
                          title={conversation.pinned ? "إلغاء التثبيت" : "تثبيت"}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            actionBusy === conversation.id
                              ? "opacity-50"
                              : "bg-inbox-hover text-inbox-muted hover:text-inbox-text"
                          }`}
                        >
                          {conversation.pinned ? "إلغاء تثبيت" : "تثبيت"}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => void handleArchive(conversation, e)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              void archiveConversation(
                                conversation.id,
                                !conversation.archived
                              )
                                .then(handleConversationUpdated)
                                .catch((err) =>
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "فشل الأرشفة"
                                  )
                                );
                            }
                          }}
                          title={
                            conversation.archived ? "إلغاء الأرشفة" : "أرشفة"
                          }
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            actionBusy === conversation.id
                              ? "opacity-50"
                              : "bg-inbox-hover text-inbox-muted hover:text-inbox-text"
                          }`}
                        >
                          {conversation.archived ? "إظهار" : "أرشفة"}
                        </span>
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {nextCursor && (
          <div className="border-t border-inbox-border p-2">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              className="w-full rounded-md bg-inbox-hover px-3 py-2 text-xs text-inbox-muted hover:text-inbox-text disabled:opacity-50"
            >
              {loadingMore ? "..." : "تحميل المزيد"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
