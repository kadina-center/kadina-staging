import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocuments,
  type KnowledgeDocument,
} from "../lib/api";

export default function KnowledgeBase({ isAdmin = false }: { isAdmin?: boolean }) {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setDocs(await getKnowledgeDocuments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التحميل");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createKnowledgeDocument({
        title: title.trim(),
        content: content.trim(),
      });
      setDocs((prev) => [created, ...prev]);
      setTitle("");
      setContent("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("حذف المستند وكل قطعه؟")) return;
    setBusy(true);
    try {
      await deleteKnowledgeDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحذف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">قاعدة المعرفة</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            مستندات وأسئلة شائعة يستخدمها الوكيل الآلي عبر RAG
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white"
          >
            {showForm ? "إغلاق" : "إضافة مستند"}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-6 space-y-3 rounded-xl border border-inbox-border bg-inbox-panel p-4"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان المستند"
            className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
            required
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="الصق نص الأسئلة الشائعة أو سياسات الشركة هنا..."
            className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "جاري التقسيم والتضمين..." : "حفظ ومعالجة"}
          </button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-inbox-muted">جاري التحميل...</p>}

      <div className="space-y-3">
        {docs.map((doc) => (
          <article
            key={doc.id}
            className="rounded-xl border border-inbox-border bg-inbox-panel p-4"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{doc.title}</h2>
                <p className="text-xs text-inbox-muted">
                  {doc.chunkCount} قطعة ·{" "}
                  {new Date(doc.createdAt).toLocaleString("ar-SA")}
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDelete(doc.id)}
                  className="rounded-md bg-red-500/20 px-2 py-1 text-xs text-red-300"
                >
                  حذف
                </button>
              )}
            </div>
            <p className="line-clamp-3 text-sm text-inbox-muted">{doc.content}</p>
          </article>
        ))}
        {!loading && docs.length === 0 && (
          <p className="text-sm text-inbox-muted">لا مستندات بعد</p>
        )}
      </div>
    </div>
  );
}
