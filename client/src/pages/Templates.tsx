import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createTemplate,
  getTemplates,
  syncTemplateStatus,
  type Template,
} from "../lib/api";
import { TEMPLATE_CATEGORY_LABELS, labelOr } from "../lib/uiLabels";

function statusColor(status: string): string {
  if (status === "approved") return "bg-emerald-500/20 text-emerald-300";
  if (status === "rejected") return "bg-red-500/20 text-red-300";
  return "bg-amber-500/20 text-amber-200";
}

function statusLabel(status: string): string {
  if (status === "approved") return "معتمد";
  if (status === "rejected") return "مرفوض";
  return "قيد المراجعة";
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "UTILITY",
    language: "ar",
    bodyText: "",
  });

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getTemplates();
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل القوالب");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createTemplate(form);
      setTemplates((prev) => [created, ...prev]);
      setShowForm(false);
      setForm({
        name: "",
        category: "UTILITY",
        language: "ar",
        bodyText: "",
      });
      if (created.warning) {
        setError(`تم الحفظ محليًا مع تحذير من ميتا: ${created.warning}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء القالب");
    } finally {
      setSaving(false);
    }
  }

  async function handleSync(id: string) {
    try {
      const updated = await syncTemplateStatus(id);
      setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل مزامنة الحالة");
    }
  }

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">قوالب الرسائل</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            القوالب تحتاج موافقة ميتا قبل الإرسال خارج نافذة الـ24 ساعة
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-inbox-accent px-4 py-2 text-sm font-medium text-white"
        >
          {showForm ? "إغلاق" : "قالب جديد"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-6 space-y-3 rounded-xl border border-inbox-border bg-inbox-panel p-4"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              الاسم
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="order_update"
                className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
            <label className="text-sm">
              الفئة
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 outline-none"
              >
                <option value="UTILITY">خدمي</option>
                <option value="MARKETING">تسويقي</option>
                <option value="AUTHENTICATION">مصادقة</option>
              </select>
            </label>
            <label className="text-sm">
              اللغة
              <input
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
                className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 outline-none"
              />
            </label>
          </div>
          <label className="block text-sm">
            نص القالب (استخدم {"{{1}}"} و{"{{2}}"} للمتغيرات)
            <textarea
              required
              rows={4}
              value={form.bodyText}
              onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
              placeholder="مرحبا {{1}}، طلبك رقم {{2}} جاهز."
              className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "جاري الإرسال لميتا..." : "إنشاء وإرسال للموافقة"}
          </button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-inbox-muted">جاري التحميل...</p>}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-inbox-border">
          <table className="min-w-full text-sm">
            <thead className="bg-inbox-panel text-inbox-muted">
              <tr>
                <th className="px-4 py-3 text-right font-medium">الاسم</th>
                <th className="px-4 py-3 text-right font-medium">الفئة</th>
                <th className="px-4 py-3 text-right font-medium">اللغة</th>
                <th className="px-4 py-3 text-right font-medium">الحالة</th>
                <th className="px-4 py-3 text-right font-medium">النص</th>
                <th className="px-4 py-3 text-right font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-inbox-muted"
                  >
                    لا توجد قوالب بعد
                  </td>
                </tr>
              )}
              {templates.map((template) => (
                <tr
                  key={template.id}
                  className="border-t border-inbox-border bg-inbox-bg/40"
                >
                  <td className="px-4 py-3 font-medium" dir="ltr">
                    {template.name}
                  </td>
                  <td className="px-4 py-3">
                    {labelOr(TEMPLATE_CATEGORY_LABELS, template.category)}
                  </td>
                  <td className="px-4 py-3">{template.language}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${statusColor(
                        template.status
                      )}`}
                    >
                      {statusLabel(template.status)}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-inbox-muted">
                    {template.bodyText}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void handleSync(template.id)}
                      className="rounded-md bg-inbox-hover px-2 py-1 text-xs hover:bg-inbox-border"
                    >
                      مزامنة الحالة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
