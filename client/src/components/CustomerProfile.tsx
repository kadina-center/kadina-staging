import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  useSocket,
  type ConversationUpdatedEvent,
  type NewMessageEvent,
  type NoteAddedEvent,
  type TimelineEventSocket,
} from "../hooks/useSocket";
import {
  archiveConversation,
  assignConversation,
  createAppointment,
  createNote,
  formatReplyTime,
  getContactMedia,
  getContactProfile,
  getNotes,
  getUsers,
  listAppointments,
  markConversationRead,
  mediaSrc,
  normalizeSenderType,
  updateAppointment,
  updateContact,
  type Appointment,
  type ContactMediaItem,
  type ContactProfile,
  type Conversation,
  type Note,
  type User,
} from "../lib/api";
import { getStoredUser } from "../lib/auth";
import {
  APPOINTMENT_STATUS_LABELS,
  CONVERSATION_STATUS_LABELS,
  MEDIA_TYPE_LABELS,
  ROLE_LABELS,
  SENDER_TYPE_LABELS,
  labelOr,
} from "../lib/uiLabels";
import CustomerTimeline from "./CustomerTimeline";

type Props = {
  conversation: Conversation | null;
  onConversationUpdated?: (conversation: Conversation) => void;
  onOpenConversation?: () => void;
};

type ProfileTab =
  | "crm"
  | "conversation"
  | "timeline"
  | "notes"
  | "appointments"
  | "media";

const CRM_STATUSES = [
  { value: "patient", label: "مريض" },
  { value: "lead", label: "عميل محتمل" },
  { value: "vip", label: "VIP" },
  { value: "blocked", label: "محظور" },
  { value: "general", label: "عام" },
];

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "crm", label: "CRM" },
  { id: "conversation", label: "المحادثة" },
  { id: "timeline", label: "السجل الزمني" },
  { id: "notes", label: "الملاحظات" },
  { id: "appointments", label: "المواعيد" },
  { id: "media", label: "الوسائط" },
];

function statusLabel(value?: string | null): string {
  return CRM_STATUSES.find((s) => s.value === value)?.label || value || "—";
}

export default function CustomerProfile({
  conversation,
  onConversationUpdated,
  onOpenConversation,
}: Props) {
  const me = getStoredUser();
  const isAdmin = me?.role === "admin";
  const contactId = conversation?.contactId ?? null;

  const [tab, setTab] = useState<ProfileTab>("crm");
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // CRM form
  const [name, setName] = useState("");
  const [crmStatus, setCrmStatus] = useState("patient");
  const [customNotes, setCustomNotes] = useState("");
  const [doctor, setDoctor] = useState("");
  const [treatment, setTreatment] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [visitCount, setVisitCount] = useState(0);

  // Notes
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteText, setNoteText] = useState("");

  // Appointments
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptTitle, setApptTitle] = useState("موعد");
  const [apptAt, setApptAt] = useState("");

  // Media
  const [media, setMedia] = useState<ContactMediaItem[]>([]);
  const [mediaCursor, setMediaCursor] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Assign
  const [users, setUsers] = useState<User[]>([]);

  const loadProfile = useCallback(async () => {
    if (!contactId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getContactProfile(contactId);
      setProfile(data);
      setName(data.contact.name || "");
      setCrmStatus(data.contact.crmStatus || "patient");
      setCustomNotes(data.contact.customNotes || "");
      setDoctor(data.contact.doctor || "");
      setTreatment(data.contact.treatment || "");
      setLeadSource(data.contact.leadSource || "");
      setVisitCount(data.contact.visitCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل الملف");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!isAdmin) return;
    void getUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [isAdmin]);

  useEffect(() => {
    if (tab !== "notes" || !profile?.conversation?.id) {
      setNotes([]);
      return;
    }
    void getNotes(profile.conversation.id)
      .then(setNotes)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "فشل تحميل الملاحظات")
      );
  }, [tab, profile?.conversation?.id]);

  useEffect(() => {
    if (tab !== "appointments" || !contactId) {
      setAppointments([]);
      return;
    }
    void listAppointments({ contactId, limit: 50 })
      .then((data) => {
        const items = Array.isArray(data) ? data : data.items;
        setAppointments(items);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "فشل تحميل المواعيد")
      );
  }, [tab, contactId]);

  useEffect(() => {
    if (tab !== "media" || !contactId) {
      setMedia([]);
      setMediaCursor(null);
      return;
    }
    void getContactMedia(contactId, { limit: 24 })
      .then((page) => {
        setMedia(page.items);
        setMediaCursor(page.nextCursor);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "فشل تحميل الوسائط")
      );
  }, [tab, contactId]);

  const refreshIfSame = useCallback(
    (cid?: string | null) => {
      if (!contactId || !cid || cid !== contactId) return;
      void loadProfile();
    },
    [contactId, loadProfile]
  );

  useSocket({
    onConversationUpdated: (payload: ConversationUpdatedEvent) => {
      if (payload.contactId === contactId || payload.id === conversation?.id) {
        void loadProfile();
        if (conversation && payload.id === conversation.id) {
          onConversationUpdated?.(payload);
        }
      }
    },
    onNewMessage: (payload: NewMessageEvent) => {
      refreshIfSame(payload.contact?.id);
    },
    onNoteAdded: (payload: NoteAddedEvent) => {
      if (payload.conversationId === profile?.conversation?.id) {
        setNotes((prev) =>
          prev.some((n) => n.id === payload.id) ? prev : [...prev, payload]
        );
        void loadProfile();
      }
    },
    onTimelineEvent: (payload: TimelineEventSocket) => {
      refreshIfSame(payload.contactId);
    },
  });

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }

  async function handleSaveCrm() {
    if (!contactId || !conversation) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateContact(contactId, {
        name: name.trim() || null,
        crmStatus,
        customNotes: customNotes.trim() || null,
        doctor: doctor.trim() || null,
        treatment: treatment.trim() || null,
        leadSource: leadSource.trim() || null,
        visitCount,
      });
      onConversationUpdated?.({
        ...conversation,
        contact: {
          ...conversation.contact,
          ...updated,
          lastMessage: conversation.contact.lastMessage,
        },
      });
      await loadProfile();
      showToast("تم حفظ CRM");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل حفظ CRM");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(userId: string) {
    if (!isAdmin || !profile?.conversation) return;
    setBusy(true);
    try {
      const updated = await assignConversation(
        profile.conversation.id,
        userId || null
      );
      onConversationUpdated?.(updated);
      await loadProfile();
      showToast(userId ? "تم التعيين" : "تم إزالة التعيين");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التعيين");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!profile?.conversation) return;
    setBusy(true);
    try {
      const updated = await archiveConversation(
        profile.conversation.id,
        !profile.conversation.archived
      );
      onConversationUpdated?.(updated);
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الأرشفة");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkRead() {
    if (!profile?.conversation) return;
    setBusy(true);
    try {
      const updated = await markConversationRead(profile.conversation.id);
      onConversationUpdated?.(updated);
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحديث القراءة");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!profile?.conversation || !noteText.trim()) return;
    setBusy(true);
    try {
      const note = await createNote(profile.conversation.id, noteText.trim());
      setNotes((prev) => [...prev, note]);
      setNoteText("");
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إضافة ملاحظة");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAppointment(e: FormEvent) {
    e.preventDefault();
    if (!contactId || !apptAt) return;
    setBusy(true);
    try {
      const created = await createAppointment({
        contactId,
        title: apptTitle.trim() || "موعد",
        scheduledAt: new Date(apptAt).toISOString(),
      });
      setAppointments((prev) => [...prev, created]);
      setApptAt("");
      await loadProfile();
      showToast("تم إنشاء الموعد");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء الموعد");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelAppointment(id: string) {
    setBusy(true);
    try {
      const updated = await updateAppointment(id, { status: "cancelled" });
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? updated : a))
      );
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إلغاء الموعد");
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreMedia() {
    if (!contactId || !mediaCursor) return;
    const page = await getContactMedia(contactId, {
      cursor: mediaCursor,
      limit: 24,
    });
    setMedia((prev) => [...prev, ...page.items]);
    setMediaCursor(page.nextCursor);
  }

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b141a] text-sm text-inbox-muted">
        اختر محادثة لعرض ملف العميل
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b141a] text-sm text-inbox-muted">
        جاري تحميل ملف العميل...
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0b141a] text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (!profile) return null;

  const c = profile.contact;
  const initial = (c.name || c.phone || "?").slice(0, 1);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b141a]" dir="rtl">
      <div className="shrink-0 border-b border-inbox-border px-4 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-inbox-accent/20 text-lg font-semibold text-inbox-accent">
            {c.avatarUrl ? (
              <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-inbox-text">
              {c.name || c.phone}
            </h2>
            <p className="text-sm text-inbox-muted" dir="ltr">
              {c.phone}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-inbox-hover px-2 py-0.5">
                الحالة: {statusLabel(c.crmStatus)}
              </span>
              <span className="rounded bg-inbox-hover px-2 py-0.5">
                معيّن إلى:{" "}
                {profile.conversation?.assignedTo?.name || "غير معيّن"}
              </span>
              <span className="rounded bg-inbox-hover px-2 py-0.5">
                آخر رد:{" "}
                {profile.lastRepliedBy?.name
                  ? `${profile.lastRepliedBy.name}${
                      normalizeSenderType(profile.lastRepliedBy.senderType)
                        ? ` · ${labelOr(
                            SENDER_TYPE_LABELS,
                            normalizeSenderType(profile.lastRepliedBy.senderType)
                          )}`
                        : ""
                    }`
                  : "—"}
              </span>
              <span className="rounded bg-inbox-hover px-2 py-0.5">
                آخر نشاط:{" "}
                {c.lastMessageAt
                  ? formatReplyTime(c.lastMessageAt)
                  : "—"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-inbox-muted">
              <span>المحادثات: {profile.counts.conversations}</span>
              <span>الرسائل: {profile.counts.messages}</span>
              <span>الزيارات: {profile.counts.visits}</span>
              <span>المواعيد: {profile.counts.appointments}</span>
              <span>الملاحظات: {profile.counts.notes}</span>
              <span>الوسائط: {profile.counts.media}</span>
            </div>
            {profile.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {profile.tags.map((t) => (
                  <span
                    key={t.id}
                    className="rounded-full px-2 py-0.5 text-[11px] text-white"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenConversation?.()}
            className="rounded-md bg-inbox-accent px-3 py-1.5 text-xs text-white"
          >
            فتح المحادثة
          </button>
          <button
            type="button"
            disabled={busy || !profile.conversation}
            onClick={() => void handleMarkRead()}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs disabled:opacity-50"
          >
            تحديد كمقروء
          </button>
          <button
            type="button"
            disabled={busy || !profile.conversation}
            onClick={() => void handleArchive()}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {profile.conversation?.archived ? "إلغاء الأرشفة" : "أرشفة"}
          </button>
          {isAdmin && profile.conversation && (
            <select
              disabled={busy}
              value={profile.conversation.assignedToId ?? ""}
              onChange={(e) => void handleAssign(e.target.value)}
              className="rounded-md bg-inbox-hover px-2 py-1.5 text-xs outline-none"
            >
              <option value="">التعيين: غير معيّن</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  تعيين: {u.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setTab("notes")}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs"
          >
            إضافة ملاحظة
          </button>
          <button
            type="button"
            onClick={() => setTab("crm")}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs"
          >
            تعديل CRM
          </button>
          <button
            type="button"
            onClick={() => setTab("appointments")}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs"
          >
            إنشاء موعد
          </button>
        </div>

        {(toast || error) && (
          <p
            className={`mt-2 text-xs ${
              error && !toast ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {toast || error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-inbox-border px-3 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === t.id
                ? "bg-inbox-accent text-white"
                : "text-inbox-muted hover:bg-inbox-hover hover:text-inbox-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="scroll-panel min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === "crm" && (
          <div className="mx-auto max-w-lg space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="text-inbox-muted">الاسم</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-inbox-muted">حالة CRM</span>
              <select
                value={crmStatus}
                onChange={(e) => setCrmStatus(e.target.value)}
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              >
                {CRM_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-inbox-muted">الطبيب</span>
              <input
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-inbox-muted">العلاج / الخدمة</span>
              <input
                value={treatment}
                onChange={(e) => setTreatment(e.target.value)}
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-inbox-muted">مصدر العميل</span>
              <input
                value={leadSource}
                onChange={(e) => setLeadSource(e.target.value)}
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-inbox-muted">عدد الزيارات</span>
              <input
                type="number"
                min={0}
                value={visitCount}
                onChange={(e) => setVisitCount(Number(e.target.value) || 0)}
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-inbox-muted">ملاحظات CRM</span>
              <textarea
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
            <p className="text-xs text-inbox-muted">
              آخر موظف: {c.lastAgent?.name || "—"}
              {c.lastAgent?.role
                ? ` · ${labelOr(ROLE_LABELS, c.lastAgent.role)}`
                : ""}
            </p>
            <p className="text-xs text-inbox-muted">
              أُنشئ: {new Date(c.createdAt).toLocaleString("ar")}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveCrm()}
              className="w-full rounded-lg bg-inbox-accent py-2.5 text-sm text-white disabled:opacity-50"
            >
              {busy ? "جاري الحفظ..." : "حفظ CRM"}
            </button>
          </div>
        )}

        {tab === "conversation" && (
          <div className="mx-auto max-w-lg space-y-3">
            {!profile.conversation ? (
              <p className="text-sm text-inbox-muted">لا توجد محادثة</p>
            ) : (
              <div className="rounded-xl border border-inbox-border bg-inbox-panel/60 p-4 text-sm">
                <div className="flex flex-wrap gap-2 text-xs text-inbox-muted">
                  <span dir="ltr">ID: {profile.conversation.id}</span>
                  <span>
                    الحالة:{" "}
                    {labelOr(
                      CONVERSATION_STATUS_LABELS,
                      profile.conversation.status
                    )}
                  </span>
                  <span>
                    {profile.conversation.archived ? "مؤرشفة" : "نشطة"}
                  </span>
                </div>
                <p className="mt-2">
                  معيّن إلى:{" "}
                  {profile.conversation.assignedTo?.name || "غير معيّن"}
                </p>
                <p className="mt-1 text-inbox-muted">
                  آخر رسالة:{" "}
                  {profile.lastMessage?.content?.slice(0, 120) || "—"}
                </p>
                <p className="mt-1 text-xs text-inbox-muted">
                  {profile.conversation.lastMessageAt
                    ? formatReplyTime(profile.conversation.lastMessageAt)
                    : "—"}{" "}
                  · الرسائل: {profile.counts.messages} · القناة:{" "}
                  {c.channel === "whatsapp"
                    ? "واتساب"
                    : c.channel || "واتساب"}
                </p>
                <p className="mt-1 text-xs text-inbox-muted">
                  آخر رد بواسطة:{" "}
                  {profile.lastRepliedBy?.name || "—"}
                  {normalizeSenderType(profile.lastRepliedBy?.senderType)
                    ? ` · ${labelOr(
                        SENDER_TYPE_LABELS,
                        normalizeSenderType(profile.lastRepliedBy?.senderType)
                      )}`
                    : ""}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenConversation?.()}
                  className="mt-3 rounded-md bg-inbox-accent px-3 py-1.5 text-xs text-white"
                >
                  فتح في صندوق الوارد
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "timeline" && (
          <div className="h-[min(70vh,560px)] min-h-[320px]">
            <CustomerTimeline contactId={contactId} />
          </div>
        )}

        {tab === "notes" && (
          <div className="mx-auto max-w-lg space-y-3">
            <form onSubmit={(e) => void handleAddNote(e)} className="flex gap-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="ملاحظة داخلية..."
                className="min-w-0 flex-1 rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={busy || !noteText.trim()}
                className="rounded-lg bg-inbox-accent px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                إضافة
              </button>
            </form>
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-lg border border-inbox-border bg-inbox-panel/50 px-3 py-2 text-sm"
                >
                  <p className="whitespace-pre-wrap">{n.content}</p>
                  <p className="mt-1 text-[11px] text-inbox-muted">
                    {n.author?.name || "—"} · {n.author?.role || "—"} ·{" "}
                    {new Date(n.createdAt).toLocaleString("ar")}
                    {n.updatedAt &&
                    n.updatedAt !== n.createdAt
                      ? ` · عُدّل ${new Date(n.updatedAt).toLocaleString("ar")}`
                      : ""}
                  </p>
                </li>
              ))}
              {notes.length === 0 && (
                <p className="text-sm text-inbox-muted">
                  لا توجد ملاحظات داخلية حتى الآن
                </p>
              )}
            </ul>
          </div>
        )}

        {tab === "appointments" && (
          <div className="mx-auto max-w-lg space-y-3">
            <form
              onSubmit={(e) => void handleCreateAppointment(e)}
              className="space-y-2 rounded-lg border border-inbox-border p-3"
            >
              <input
                value={apptTitle}
                onChange={(e) => setApptTitle(e.target.value)}
                placeholder="عنوان الموعد"
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
              />
              <input
                type="datetime-local"
                value={apptAt}
                onChange={(e) => setApptAt(e.target.value)}
                className="w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={busy || !apptAt}
                className="rounded-lg bg-inbox-accent px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                إنشاء موعد
              </button>
            </form>
            <ul className="space-y-2">
              {appointments.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-inbox-border bg-inbox-panel/50 px-3 py-2 text-sm"
                >
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-inbox-muted">
                    {new Date(a.scheduledAt).toLocaleString("ar")} ·{" "}
                    {labelOr(APPOINTMENT_STATUS_LABELS, a.status)}
                    {a.agent?.name ? ` · ${a.agent.name}` : ""}
                    {a.durationMinutes ? ` · ${a.durationMinutes}د` : ""}
                  </div>
                  {a.notes && (
                    <p className="mt-1 text-xs text-inbox-muted">{a.notes}</p>
                  )}
                  {a.status === "scheduled" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleCancelAppointment(a.id)}
                      className="mt-2 text-xs text-red-400"
                    >
                      إلغاء
                    </button>
                  )}
                </li>
              ))}
              {appointments.length === 0 && (
                <p className="text-sm text-inbox-muted">لا مواعيد</p>
              )}
            </ul>
          </div>
        )}

        {tab === "media" && (
          <div className="mx-auto max-w-2xl">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {media.map((m) => {
                const src = mediaSrc(m.mediaUrl);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => src && setLightbox(src)}
                    className="overflow-hidden rounded-lg border border-inbox-border bg-inbox-panel/40 text-right"
                  >
                    {src && m.type === "image" ? (
                      <img
                        src={src}
                        alt=""
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-xs text-inbox-muted">
                        {labelOr(MEDIA_TYPE_LABELS, m.type)}
                      </div>
                    )}
                    <div className="px-2 py-1 text-[10px] text-inbox-muted">
                      {m.createdByName || m.senderName || m.direction} ·{" "}
                      {new Date(m.createdAt).toLocaleDateString("ar")}
                    </div>
                  </button>
                );
              })}
            </div>
            {media.length === 0 && (
              <p className="text-sm text-inbox-muted">لا مرفقات</p>
            )}
            {mediaCursor && (
              <button
                type="button"
                onClick={() => void loadMoreMedia()}
                className="mt-3 rounded-md bg-inbox-hover px-3 py-1.5 text-xs"
              >
                المزيد
              </button>
            )}
          </div>
        )}
      </div>

      {lightbox && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      )}
    </div>
  );
}
