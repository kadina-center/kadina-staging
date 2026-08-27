import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  useSocket,
  type NoteAddedEvent,
} from "../hooks/useSocket";
import {
  createNote,
  createUser,
  deleteNote,
  getNotes,
  getUsers,
  updateContact,
  updateNote,
  type Conversation,
  type Note,
  type User,
} from "../lib/api";
import { getStoredUser } from "../lib/auth";
import { CONVERSATION_STATUS_LABELS, labelOr } from "../lib/uiLabels";

type Props = {
  conversation: Conversation | null;
  onConversationUpdated?: (conversation: Conversation) => void;
  onClose?: () => void;
};

const CRM_STATUSES = [
  { value: "patient", label: "مريض" },
  { value: "lead", label: "عميل محتمل" },
  { value: "vip", label: "VIP" },
  { value: "blocked", label: "محظور" },
  { value: "general", label: "عام" },
];

/**
 * Internal team notes panel.
 * Content created here is stored as Note records only —
 * it is NEVER sent to WhatsApp / the customer.
 */
export default function NotesPanel({
  conversation,
  onConversationUpdated,
  onClose,
}: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const currentUser = getStoredUser();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [crmStatus, setCrmStatus] = useState("patient");
  const [customNotes, setCustomNotes] = useState("");
  const [crmBusy, setCrmBusy] = useState(false);
  const [crmSaved, setCrmSaved] = useState(false);

  const conversationId = conversation?.id ?? null;

  useEffect(() => {
    if (!conversation) {
      setCrmStatus("patient");
      setCustomNotes("");
      return;
    }
    setCrmStatus(conversation.contact.crmStatus || "patient");
    setCustomNotes(conversation.contact.customNotes || "");
  }, [conversation]);

  const loadUsers = useCallback(async () => {
    const data = await getUsers();
    setUsers(data);
  }, []);

  useEffect(() => {
    void loadUsers().catch(() => {
      setUsers([]);
    });
  }, [loadUsers]);

  useEffect(() => {
    if (!conversationId) {
      setNotes([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void getNotes(conversationId)
      .then((data) => {
        if (!cancelled) setNotes(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "فشل تحميل الملاحظات");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const handleNoteAdded = useCallback(
    (payload: NoteAddedEvent) => {
      if (!conversationId || payload.conversationId !== conversationId) return;
      setNotes((prev) => {
        if (prev.some((n) => n.id === payload.id)) return prev;
        return [...prev, payload];
      });
    },
    [conversationId]
  );

  useSocket({ onNoteAdded: handleNoteAdded });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!conversationId || !content.trim() || submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      const note = await createNote(conversationId, {
        authorId: currentUser?.id || "",
        content: content.trim(),
      });
      setNotes((prev) => {
        if (prev.some((n) => n.id === note.id)) return prev;
        return [...prev, note];
      });
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إضافة الملاحظة");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(noteId: string) {
    if (!conversationId || !editContent.trim()) return;
    setError(null);
    try {
      const updated = await updateNote(
        conversationId,
        noteId,
        editContent.trim()
      );
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      setEditingId(null);
      setEditContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحديث الملاحظة");
    }
  }

  async function handleDelete(noteId: string) {
    if (!conversationId) return;
    if (!window.confirm("حذف هذه الملاحظة؟")) return;
    setError(null);
    try {
      await deleteNote(conversationId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل حذف الملاحظة");
    }
  }

  async function handleSaveCrm() {
    if (!conversation) return;
    setCrmBusy(true);
    setError(null);
    setCrmSaved(false);
    try {
      const contact = await updateContact(conversation.contactId, {
        crmStatus,
        customNotes: customNotes.trim() || null,
      });
      setCrmStatus(contact.crmStatus || crmStatus);
      setCustomNotes(contact.customNotes || "");
      onConversationUpdated?.({
        ...conversation,
        contact: {
          ...conversation.contact,
          crmStatus: contact.crmStatus,
          customNotes: contact.customNotes,
        },
      });
      setCrmSaved(true);
      window.setTimeout(() => setCrmSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل حفظ CRM");
    } finally {
      setCrmBusy(false);
    }
  }

  async function handleQuickCreateUser() {
    if (currentUser?.role !== "admin") {
      setError("إنشاء موظف يتطلب صلاحية مدير");
      return;
    }
    const name = window.prompt("اسم الموظف");
    if (!name?.trim()) return;
    const email = window.prompt("البريد الإلكتروني");
    if (!email?.trim()) return;
    const password = window.prompt("كلمة المرور (6 أحرف على الأقل)");
    if (!password || password.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }

    setCreatingUser(true);
    setError(null);
    try {
      const user = await createUser({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      setUsers((prev) => [...prev, user]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء المستخدم");
    } finally {
      setCreatingUser(false);
    }
  }

  const panelClass =
    "flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-inbox-border bg-inbox-panel text-inbox-text";

  if (!conversation) {
    return (
      <aside className={panelClass} dir="rtl">
        <header className="shrink-0 border-b border-inbox-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">الملاحظات الداخلية</h3>
              <p className="mt-0.5 text-[11px] text-inbox-muted">
                للفريق فقط — لا تُرسل للعميل
              </p>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-2 py-1 text-xs text-inbox-muted hover:bg-inbox-hover hover:text-inbox-text"
              >
                إغلاق
              </button>
            )}
          </div>
        </header>
        <p className="p-4 text-sm text-inbox-muted">
          اختر محادثة لعرض الملاحظات الداخلية
        </p>
      </aside>
    );
  }

  return (
    <aside className={panelClass} dir="rtl">
      <header className="shrink-0 border-b border-inbox-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">الملاحظات الداخلية</h3>
            <p className="mt-0.5 text-[11px] text-amber-200/90">
              داخلية للفريق — لا تُرسل عبر واتساب
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-inbox-muted hover:bg-inbox-hover hover:text-inbox-text"
            >
              إغلاق
            </button>
          )}
        </div>
      </header>

      <div className="scroll-panel min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3">
        <section className="rounded-lg border border-inbox-border bg-inbox-hover/40 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-inbox-muted">جهة الاتصال</p>
          <p className="font-medium">
            {conversation.contact.name || "بدون اسم"}
          </p>
          <p className="text-xs text-inbox-muted" dir="ltr">
            {conversation.contact.phone}
          </p>
          <p className="mt-2 text-xs text-inbox-muted">
            الحالة:{" "}
            <span className="text-inbox-text">
              {labelOr(CONVERSATION_STATUS_LABELS, conversation.status)}
            </span>
            {" · "}
            المعيّن إلى:{" "}
            <span className="text-inbox-text">
              {conversation.assignedTo?.name || "غير معيّن"}
            </span>
          </p>

          <div className="mt-3 space-y-2 border-t border-inbox-border pt-3">
            <p className="text-xs font-medium text-inbox-muted">CRM</p>
            <select
              value={crmStatus}
              onChange={(e) => setCrmStatus(e.target.value)}
              disabled={crmBusy}
              className="w-full rounded-md border border-inbox-border bg-inbox-bg px-2 py-1.5 text-xs text-inbox-text outline-none disabled:opacity-60"
            >
              {CRM_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <textarea
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              rows={2}
              disabled={crmBusy}
              placeholder="ملاحظات CRM..."
              className="w-full resize-none rounded-md border border-inbox-border bg-inbox-bg px-2 py-1.5 text-xs text-inbox-text outline-none disabled:opacity-60"
            />
            <button
              type="button"
              disabled={crmBusy}
              onClick={() => void handleSaveCrm()}
              className="w-full rounded-md bg-inbox-accent px-2 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
            >
              {crmBusy ? "جاري الحفظ..." : "حفظ CRM"}
            </button>
            {crmSaved && (
              <p className="text-xs text-emerald-400">تم حفظ CRM بنجاح</p>
            )}
          </div>
        </section>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-inbox-muted">سجل الملاحظات</p>
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
            داخلي
          </span>
        </div>

        {loading && (
          <p className="text-sm text-inbox-muted">جاري تحميل الملاحظات...</p>
        )}
        {!loading && notes.length === 0 && (
          <div className="rounded-lg border border-dashed border-inbox-border px-3 py-6 text-center">
            <p className="text-sm text-inbox-muted">
              لا توجد ملاحظات داخلية حتى الآن
            </p>
          </div>
        )}

        {notes.map((note) => (
          <article
            key={note.id}
            className="rounded-lg border border-inbox-border border-r-2 border-r-amber-400/70 bg-inbox-bg/80 p-3"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-inbox-muted">
              <span className="font-medium text-inbox-text">
                {note.author.name}
              </span>
              <span dir="ltr">
                {new Date(note.createdAt).toLocaleString("ar-SA", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </div>
            {editingId === note.id ? (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-inbox-border bg-inbox-hover px-2 py-1.5 text-sm text-inbox-text outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveEdit(note.id)}
                    className="rounded-md bg-inbox-accent px-2.5 py-1 text-xs text-white"
                  >
                    حفظ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setEditContent("");
                    }}
                    className="rounded-md border border-inbox-border px-2.5 py-1 text-xs text-inbox-muted"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm leading-6 text-inbox-text">
                  {note.content}
                </p>
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(note.id);
                      setEditContent(note.content);
                    }}
                    className="text-[11px] text-inbox-accent hover:underline"
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(note.id)}
                    className="text-[11px] text-red-400 hover:underline"
                  >
                    حذف
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="shrink-0 space-y-2 border-t border-inbox-border bg-inbox-bg/50 px-3 py-3"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-inbox-muted">
          <span>
            بواسطة: {currentUser?.name || "المستخدم الحالي"}
            {users.length > 0 ? ` · الفريق ${users.length}` : ""}
          </span>
          {currentUser?.role === "admin" && (
            <button
              type="button"
              disabled={creatingUser}
              onClick={() => void handleQuickCreateUser()}
              className="rounded-md border border-inbox-border bg-inbox-hover px-2 py-1 text-xs text-inbox-text hover:border-inbox-accent disabled:opacity-50"
            >
              + موظف
            </button>
          )}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          disabled={submitting}
          placeholder="اكتب ملاحظة داخلية..."
          className="w-full resize-none rounded-lg border border-inbox-border bg-inbox-hover px-3 py-2 text-sm text-inbox-text outline-none focus:border-inbox-accent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!content.trim() || submitting}
          className="w-full rounded-lg bg-inbox-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "جاري الحفظ..." : "إضافة ملاحظة"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>
    </aside>
  );
}
