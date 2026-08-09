import { useCallback, useEffect, useState } from "react";
import { getFlows, updateFlow, type Flow } from "../lib/api";

type Props = {
  onCreate: () => void;
  onEdit: (flowId: string) => void;
};

function triggerLabel(flow: Flow): string {
  if (flow.triggerType === "keyword") {
    return `كلمة مفتاحية: ${flow.triggerValue || "—"}`;
  }
  if (flow.triggerType === "any_message") return "أي رسالة";
  if (flow.triggerType === "no_response_24h") return "لا رد خلال 24 ساعة";
  return flow.triggerType;
}

export default function Flows({ onCreate, onEdit }: Props) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setFlows(await getFlows());
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التحميل");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(flow: Flow) {
    try {
      const updated = await updateFlow(flow.id, { isActive: !flow.isActive });
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? updated : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التحديث");
    }
  }

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">روبوت الدردشة</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            تدفقات المُشغّل ← الإجراءات بدون كود
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-lg bg-inbox-accent px-4 py-2 text-sm font-medium text-white"
        >
          تدفق جديد
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-inbox-muted">جاري التحميل...</p>}

      <div className="space-y-3">
        {!loading && flows.length === 0 && (
          <p className="rounded-xl border border-inbox-border bg-inbox-panel p-6 text-sm text-inbox-muted">
            لا توجد تدفقات بعد — أنشئ أول تدفق للرد التلقائي.
          </p>
        )}

        {flows.map((flow) => (
          <div
            key={flow.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-inbox-border bg-inbox-panel px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{flow.name}</h2>
              <p className="text-xs text-inbox-muted">
                {triggerLabel(flow)} · {flow.steps.length} خطوة
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs text-inbox-muted">
              <span>{flow.isActive ? "مفعّل" : "معطّل"}</span>
              <button
                type="button"
                role="switch"
                aria-checked={flow.isActive}
                onClick={() => void toggleActive(flow)}
                className={`relative h-6 w-11 rounded-full transition ${
                  flow.isActive ? "bg-inbox-accent" : "bg-inbox-border"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                    flow.isActive ? "right-0.5" : "left-0.5"
                  }`}
                />
              </button>
            </label>

            <button
              type="button"
              onClick={() => onEdit(flow.id)}
              className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs hover:bg-inbox-border"
            >
              تعديل
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
