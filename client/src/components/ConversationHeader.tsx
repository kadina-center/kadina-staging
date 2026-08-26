import { useEffect, useState } from "react";
import {
  addConversationTag,
  assignConversation,
  createTag,
  formatReplyTime,
  getTags,
  getUsers,
  lockConversation,
  normalizeSenderType,
  removeConversationTag,
  unlockConversation,
  updateConversationStatus,
  type Conversation,
  type Tag,
  type User,
} from "../lib/api";
import { getStoredUser } from "../lib/auth";

export type LastRepliedBy = {
  name: string;
  senderType?: string | null;
  at: string;
} | null;

type Props = {
  conversation: Conversation;
  onUpdated: (conversation: Conversation) => void;
  lastRepliedBy?: LastRepliedBy;
};

const STATUS_LABELS: Record<string, string> = {
  open: "مفتوحة",
  pending: "معلقة",
  closed: "مغلقة",
};

const LOCK_STALE_MS = 15 * 60 * 1000;

function isLockActive(conversation: Conversation): boolean {
  if (!conversation.lockedById || !conversation.lockedAt) return false;
  return Date.now() - new Date(conversation.lockedAt).getTime() <= LOCK_STALE_MS;
}

function senderTypeLabel(value?: string | null): string {
  const t = normalizeSenderType(value);
  if (t === "ADMIN") return "مدير";
  if (t === "AGENT") return "موظف";
  if (t === "AI") return "AI";
  if (t === "BOT") return "بوت";
  if (t === "SYSTEM" || t === "AUTOMATION") return "نظام";
  return t || "";
}

export default function ConversationHeader({
  conversation,
  onUpdated,
  lastRepliedBy,
}: Props) {
  const me = getStoredUser();
  const isAdmin = me?.role === "admin";
  const [users, setUsers] = useState<User[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      isAdmin ? getUsers() : Promise.resolve([] as User[]),
      getTags(),
    ])
      .then(([u, t]) => {
        setUsers(u);
        setAllTags(t);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "فشل التحميل");
      });
  }, [isAdmin]);

  async function handleStatusChange(status: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateConversationStatus(conversation.id, status);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحديث الحالة");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(userId: string) {
    if (!isAdmin) return;
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      const updated = await assignConversation(
        conversation.id,
        userId || null
      );
      onUpdated(updated);
      const name =
        updated.assignedTo?.name ||
        (userId ? users.find((u) => u.id === userId)?.name : null);
      setToast(
        userId
          ? `تم التعيين إلى ${name || "الموظف"}`
          : "تم إزالة التعيين"
      );
      window.setTimeout(() => setToast(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التعيين");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddExistingTag(tagId: string) {
    if (!tagId) return;
    if (conversation.tags.some((t) => t.id === tagId)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await addConversationTag(conversation.id, tagId);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إضافة الوسم");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveTag(tagId: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await removeConversationTag(conversation.id, tagId);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إزالة الوسم");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAndAttachTag() {
    const name = newTagName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const tag = await createTag({ name });
      setAllTags((prev) => [...prev, tag]);
      const updated = await addConversationTag(conversation.id, tag.id);
      onUpdated(updated);
      setNewTagName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء الوسم");
    } finally {
      setBusy(false);
    }
  }

  const availableTags = allTags.filter(
    (t) => !conversation.tags.some((ct) => ct.id === t.id)
  );

  const assignedLabel = conversation.assignedTo
    ? `${conversation.assignedTo.name} · ${
        conversation.assignedTo.role === "admin" ? "مدير" : "موظف"
      }`
    : "غير معيّن";
  const statusLabel =
    STATUS_LABELS[conversation.status] || conversation.status;
  const channelLabel = conversation.channel
    ? conversation.channel.displayName ||
      conversation.channel.phoneNumber ||
      "واتساب"
    : null;
  const repliedType = senderTypeLabel(lastRepliedBy?.senderType);
  const lockActive = isLockActive(conversation);
  const lockedByMe = Boolean(lockActive && conversation.lockedById === me?.id);
  const lockedByOther = Boolean(
    lockActive && conversation.lockedById && conversation.lockedById !== me?.id
  );
  const canUnlock = lockedByMe || (isAdmin && lockActive);

  async function handleLockToggle() {
    if (lockActive && canUnlock) {
      if (!window.confirm("فتح قفل المحادثة؟")) return;
      setBusy(true);
      setError(null);
      try {
        const updated = await unlockConversation(conversation.id);
        onUpdated(updated);
        setToast("تم فتح القفل");
      } catch (err) {
        setError(err instanceof Error ? err.message : "فشل فتح القفل");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (lockedByOther) {
      setError("المحادثة مقفلة بواسطة موظف آخر");
      return;
    }
    if (!window.confirm("قفل المحادثة لمنع تعارض الردود؟")) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await lockConversation(conversation.id);
      onUpdated(updated);
      setToast("تم قفل المحادثة");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل القفل");
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="border-b border-inbox-border bg-inbox-panel px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inbox-accent/20 font-semibold text-inbox-accent">
            {(conversation.contact.name || conversation.contact.phone).slice(
              0,
              1
            )}
          </div>
          <div className="min-w-0 space-y-0.5">
            <h2 className="truncate text-base font-semibold text-inbox-text">
              {conversation.contact.name || conversation.contact.phone}
            </h2>
            <p className="text-xs text-inbox-muted" dir="ltr">
              {conversation.contact.phone}
            </p>
            {channelLabel && (
              <p className="text-xs text-inbox-muted">
                قناة واتساب: <span dir="ltr">{channelLabel}</span>
              </p>
            )}
            <p className="text-xs text-inbox-muted">
              الحالة:{" "}
              <span className="text-inbox-text">{statusLabel}</span>
              {conversation.archived ? (
                <>
                  {" · "}
                  <span className="text-amber-300/90">مؤرشفة</span>
                </>
              ) : null}
              {" · "}
              المعيّن له:{" "}
              <span
                className={
                  conversation.assignedTo
                    ? "text-inbox-text"
                    : "text-amber-300/90"
                }
              >
                {assignedLabel}
              </span>
              {lockActive ? (
                <>
                  {" · "}
                  <span className="text-sky-300">
                    مقفلة
                    {conversation.lockedBy?.name
                      ? ` بواسطة ${conversation.lockedBy.name}`
                      : ""}
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {lastRepliedBy && (
          <div className="rounded-md border border-inbox-border/80 bg-inbox-hover/40 px-3 py-1.5 text-right">
            <p className="text-[10px] text-inbox-muted">آخر رد بواسطة</p>
            <p className="text-sm font-medium text-inbox-text">
              {lastRepliedBy.name}
              {repliedType ? ` · ${repliedType}` : ""}
            </p>
            <p className="text-[11px] text-inbox-muted" dir="ltr">
              {formatReplyTime(lastRepliedBy.at)}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1 text-xs text-inbox-muted">
          <span>القفل</span>
          <button
            type="button"
            disabled={busy || (lockedByOther && !isAdmin)}
            onClick={() => void handleLockToggle()}
            className={`rounded-md px-2.5 py-1.5 text-sm disabled:opacity-50 ${
              lockActive
                ? "bg-sky-600/80 text-white"
                : "bg-inbox-hover text-inbox-text"
            }`}
          >
            {lockActive && canUnlock
              ? "فتح القفل"
              : lockedByOther
                ? "مقفلة"
                : "قفل"}
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs text-inbox-muted">
          الحالة
          <select
            disabled={busy}
            value={conversation.status}
            onChange={(e) => void handleStatusChange(e.target.value)}
            className="rounded-md bg-inbox-hover px-2 py-1.5 text-sm text-inbox-text outline-none"
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-xs text-inbox-muted">
          <span>المعيّن له</span>
          {isAdmin ? (
            <select
              disabled={busy}
              value={conversation.assignedToId ?? ""}
              onChange={(e) => void handleAssign(e.target.value)}
              className="rounded-md bg-inbox-hover px-2 py-1.5 text-sm text-inbox-text outline-none"
            >
              <option value="">غير معيّن</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                  {user.role === "agent"
                    ? " · موظف"
                    : user.role === "admin"
                      ? " · مدير"
                      : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-md bg-inbox-hover px-2 py-1.5 text-sm text-inbox-text">
              {assignedLabel}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {conversation.tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            disabled={busy}
            onClick={() => void handleRemoveTag(tag.id)}
            title="إزالة الوسم"
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs text-white"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
            <span aria-hidden>×</span>
          </button>
        ))}

        <select
          disabled={busy || availableTags.length === 0}
          defaultValue=""
          onChange={(e) => {
            void handleAddExistingTag(e.target.value);
            e.target.value = "";
          }}
          className="rounded-md bg-inbox-hover px-2 py-1 text-xs text-inbox-text outline-none"
        >
          <option value="">إضافة وسم...</option>
          {availableTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="وسم جديد"
            className="w-28 rounded-md bg-inbox-hover px-2 py-1 text-xs text-inbox-text outline-none"
          />
          <button
            type="button"
            disabled={busy || !newTagName.trim()}
            onClick={() => void handleCreateAndAttachTag()}
            className="rounded-md bg-inbox-accent px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            +
          </button>
        </div>
      </div>

      {toast && (
        <p className="mt-2 text-xs text-emerald-400">{toast}</p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </header>
  );
}
