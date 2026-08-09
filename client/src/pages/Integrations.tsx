import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  exportContactsToGoogleSheet,
  getWebhookSubscriptions,
  testWebhookSubscription,
  type WebhookSubscription,
} from "../lib/api";

const EVENT_OPTIONS = [
  { id: "message.received", label: "استلام رسالة" },
  { id: "conversation.assigned", label: "تعيين محادثة" },
  { id: "campaign.completed", label: "اكتمال حملة" },
] as const;

export default function Integrations() {
  const [subs, setSubs] = useState<WebhookSubscription[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.received"]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [sheetToken, setSheetToken] = useState("");
  const [sheetResult, setSheetResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSubs(await getWebhookSubscriptions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التحميل");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleEvent(id: string) {
    setEvents((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!url.trim() || events.length === 0) return;
    setBusy(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const created = await createWebhookSubscription(url.trim(), events);
      setCreatedSecret(created.secret || null);
      setUrl("");
      setEvents(["message.received"]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الإنشاء");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("حذف هذا الاشتراك؟")) return;
    try {
      await deleteWebhookSubscription(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحذف");
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    setError(null);
    try {
      const result = await testWebhookSubscription(id);
      alert(
        result.ok
          ? `نجح الاختبار (HTTP ${result.status})`
          : `فشل الاختبار (HTTP ${result.status})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الاختبار");
    } finally {
      setTestingId(null);
    }
  }

  async function handleSheetExport(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSheetResult(null);
    setError(null);
    try {
      const result = await exportContactsToGoogleSheet(
        sheetId.trim(),
        sheetToken.trim()
      );
      setSheetResult(`تم تصدير ${result.rowsWritten} جهة اتصال`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التصدير");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">التكاملات</h1>
        <p className="mt-1 text-sm text-inbox-muted">
          Webhooks صادرة لـ Zapier/Make، وتصدير جهات الاتصال إلى Google Sheets
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {createdSecret && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <p className="font-medium text-amber-200">
            احفظ الـ Secret الآن — لن يظهر مرة أخرى:
          </p>
          <code className="mt-1 block break-all text-xs text-inbox-text">
            {createdSecret}
          </code>
        </div>
      )}

      <section className="mb-8 rounded-xl border border-inbox-border bg-inbox-panel p-4">
        <h2 className="mb-3 text-lg font-medium">Webhooks الصادرة</h2>

        <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
          <label className="block text-sm">
            رابط الاستقبال (URL)
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/..."
              className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              dir="ltr"
            />
          </label>

          <fieldset>
            <legend className="mb-2 text-sm">الأحداث</legend>
            <div className="flex flex-wrap gap-3">
              {EVENT_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 text-sm text-inbox-muted"
                >
                  <input
                    type="checkbox"
                    checked={events.includes(opt.id)}
                    onChange={() => toggleEvent(opt.id)}
                  />
                  {opt.label}
                  <span className="text-xs opacity-60" dir="ltr">
                    ({opt.id})
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={busy || !events.length}
            className="rounded-md bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            إضافة اشتراك
          </button>
        </form>

        <ul className="mt-5 divide-y divide-inbox-border">
          {subs.length === 0 && (
            <li className="py-3 text-sm text-inbox-muted">لا توجد اشتراكات بعد</li>
          )}
          {subs.map((sub) => (
            <li
              key={sub.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" dir="ltr">
                  {sub.url}
                </p>
                <p className="mt-1 text-xs text-inbox-muted" dir="ltr">
                  {sub.events}
                </p>
                <p className="mt-0.5 text-[11px] text-inbox-muted">
                  {sub.isActive ? "نشط" : "متوقف"} ·{" "}
                  {new Date(sub.createdAt).toLocaleString("ar-SA")}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleTest(sub.id)}
                  disabled={testingId === sub.id}
                  className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs hover:bg-inbox-border disabled:opacity-50"
                >
                  {testingId === sub.id ? "..." : "اختبار"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(sub.id)}
                  className="rounded-md bg-red-500/15 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/25"
                >
                  حذف
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
        <h2 className="mb-3 text-lg font-medium">Google Sheets</h2>
        <p className="mb-3 text-xs text-inbox-muted">
          الصق رمز الوصول من Google Cloud Console ومعرّف جدول البيانات لتصدير
          جهات الاتصال (OAuth كامل لاحقًا).
        </p>
        <form onSubmit={(e) => void handleSheetExport(e)} className="space-y-3">
          <label className="block text-sm">
            معرّف جدول البيانات (Spreadsheet ID)
            <input
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              required
              className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              dir="ltr"
            />
          </label>
          <label className="block text-sm">
            رمز الوصول
            <input
              value={sheetToken}
              onChange={(e) => setSheetToken(e.target.value)}
              required
              className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              dir="ltr"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            تصدير جهات الاتصال
          </button>
          {sheetResult && (
            <p className="text-sm text-emerald-400">{sheetResult}</p>
          )}
        </form>
      </section>
    </div>
  );
}
