import { useEffect, useState, type FormEvent } from "react";
import { getAiSettings, updateAiSettings, type AiSettings } from "../lib/api";

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getAiSettings()
      .then(setSettings)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "فشل التحميل");
      });
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateAiSettings({
        isActive: settings.isActive,
        systemPrompt: settings.systemPrompt,
        confidenceThreshold: settings.confidenceThreshold,
        handoffKeywords: settings.handoffKeywords,
      });
      setSettings(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <div className="p-6 text-sm text-inbox-muted" dir="rtl">
        {error || "جاري التحميل..."}
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">إعدادات الذكاء الاصطناعي</h1>
        <p className="mt-1 text-sm text-inbox-muted">
          الوكيل الآلي يرد تلقائيًا؛ الـ Copilot يقترح فقط دون إرسال
        </p>
      </div>

      <form
        onSubmit={(e) => void handleSave(e)}
        className="space-y-5 rounded-xl border border-inbox-border bg-inbox-panel p-4"
      >
        <label className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">تفعيل الوكيل الآلي</p>
            <p className="text-xs text-inbox-muted">
              عند التفعيل: يرد على الرسائل غير المطابقة لكلمة مفتاحية في Flow
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.isActive}
            onClick={() =>
              setSettings({ ...settings, isActive: !settings.isActive })
            }
            className={`relative h-6 w-11 rounded-full transition ${
              settings.isActive ? "bg-inbox-accent" : "bg-inbox-border"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                settings.isActive ? "right-0.5" : "left-0.5"
              }`}
            />
          </button>
        </label>

        <label className="block text-sm">
          تعليمات النظام
          <textarea
            value={settings.systemPrompt}
            onChange={(e) =>
              setSettings({ ...settings, systemPrompt: e.target.value })
            }
            rows={8}
            className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="block text-sm">
          حد الثقة ({settings.confidenceThreshold.toFixed(2)})
          <input
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={settings.confidenceThreshold}
            onChange={(e) =>
              setSettings({
                ...settings,
                confidenceThreshold: Number(e.target.value),
              })
            }
            className="mt-2 w-full"
          />
          <p className="mt-1 text-xs text-inbox-muted">
            إن كان تشابه المعرفة أقل من هذا الحد يتم التحويل لموظف فورًا بدون
            تخمين
          </p>
        </label>

        <label className="block text-sm">
          كلمات التحويل للموظف (مفصولة بفاصلة)
          <input
            value={settings.handoffKeywords}
            onChange={(e) =>
              setSettings({ ...settings, handoffKeywords: e.target.value })
            }
            className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && <p className="text-sm text-emerald-300">تم الحفظ</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "..." : "حفظ الإعدادات"}
        </button>
      </form>
    </div>
  );
}
