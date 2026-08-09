import { useEffect, useState, type FormEvent } from "react";
import {
  addFlowStep,
  createFlow,
  deleteFlowStep,
  getFlow,
  getTags,
  getTemplates,
  getUsers,
  reorderFlowSteps,
  updateFlow,
  type Flow,
  type FlowStep,
  type Tag,
  type Template,
  type User,
} from "../lib/api";

type Props = {
  flowId: string | null;
  onBack: () => void;
  onSaved: (flowId: string) => void;
};

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "send_text", label: "إرسال نص" },
  { value: "send_template", label: "إرسال قالب" },
  { value: "assign_to_user", label: "تعيين لموظف" },
  { value: "add_tag", label: "إضافة وسم" },
  { value: "set_status", label: "تغيير حالة المحادثة" },
  { value: "wait", label: "انتظار (ثوانٍ)" },
  { value: "ai_agent_reply", label: "رد وكيل الذكاء الاصطناعي" },
];

function actionSummary(step: FlowStep): string {
  return `${step.actionType}: ${step.actionValue}`;
}

export default function FlowBuilder({ flowId, onBack, onSaved }: Props) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("keyword");
  const [triggerValue, setTriggerValue] = useState("");
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStepForm, setShowStepForm] = useState(false);
  const [actionType, setActionType] = useState("send_text");
  const [actionValue, setActionValue] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    void Promise.all([getUsers(), getTags(), getTemplates()])
      .then(([u, t, tpl]) => {
        setUsers(u);
        setTags(t);
        setTemplates(tpl.filter((x) => x.status === "approved"));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!flowId) {
      setFlow(null);
      setName("");
      setTriggerType("keyword");
      setTriggerValue("");
      setSteps([]);
      return;
    }

    void getFlow(flowId)
      .then((data) => {
        setFlow(data);
        setName(data.name);
        setTriggerType(data.triggerType);
        setTriggerValue(data.triggerValue || "");
        setSteps(data.steps);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "فشل التحميل");
      });
  }, [flowId]);

  async function handleSaveMeta(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("اسم التدفق مطلوب");
      return;
    }
    if (triggerType === "keyword" && !triggerValue.trim()) {
      setError("الكلمة المفتاحية مطلوبة");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (!flowId) {
        const created = await createFlow({
          name: name.trim(),
          triggerType,
          triggerValue:
            triggerType === "keyword" ? triggerValue.trim() : null,
        });
        setFlow(created);
        setSteps(created.steps);
        onSaved(created.id);
      } else {
        const updated = await updateFlow(flowId, {
          name: name.trim(),
          triggerType,
          triggerValue:
            triggerType === "keyword" ? triggerValue.trim() : null,
        });
        setFlow(updated);
        setSteps(updated.steps);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddStep(event: FormEvent) {
    event.preventDefault();
    if (!flow?.id) {
      setError("احفظ إعدادات التدفق أولًا");
      return;
    }
    const resolvedValue =
      actionType === "ai_agent_reply"
        ? actionValue.trim() || "auto"
        : actionValue.trim();

    if (!resolvedValue) {
      setError("قيمة الإجراء مطلوبة");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const step = await addFlowStep(flow.id, {
        actionType,
        actionValue: resolvedValue,
      });
      setSteps((prev) => [...prev, step].sort((a, b) => a.order - b.order));
      setShowStepForm(false);
      setActionType("send_text");
      setActionValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إضافة الخطوة");
    } finally {
      setBusy(false);
    }
  }

  async function moveStep(index: number, direction: -1 | 1) {
    if (!flow?.id) return;
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;

    const next = [...steps];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;

    setBusy(true);
    try {
      const reordered = await reorderFlowSteps(
        flow.id,
        next.map((s) => s.id)
      );
      setSteps(reordered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إعادة الترتيب");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteStep(stepId: string) {
    if (!flow?.id) return;
    setBusy(true);
    try {
      await deleteFlowStep(flow.id, stepId);
      const refreshed = await getFlow(flow.id);
      setSteps(refreshed.steps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحذف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-2 text-xs text-inbox-muted hover:text-inbox-text"
          >
            ← رجوع للتدفقات
          </button>
          <h1 className="text-2xl font-semibold">
            {flowId ? "تعديل التدفق" : "تدفق جديد"}
          </h1>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <form
        onSubmit={(e) => void handleSaveMeta(e)}
        className="mb-6 space-y-3 rounded-xl border border-inbox-border bg-inbox-panel p-4"
      >
        <h2 className="font-semibold">المُشغّل</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم التدفق"
          className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
        />
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value)}
          className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
        >
          <option value="keyword">كلمة مفتاحية</option>
          <option value="any_message">أي رسالة (افتراضي)</option>
          <option value="no_response_24h">لا رد خلال 24 ساعة (للجدولة لاحقًا)</option>
        </select>
        {triggerType === "keyword" && (
          <input
            value={triggerValue}
            onChange={(e) => setTriggerValue(e.target.value)}
            placeholder="مثال: أسعار"
            className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
          />
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {flowId ? "حفظ الإعدادات" : "إنشاء التدفق"}
        </button>
      </form>

      <section className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-semibold">الخطوات</h2>
          <button
            type="button"
            disabled={!flow?.id || busy}
            onClick={() => setShowStepForm((v) => !v)}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs disabled:opacity-50"
          >
            إضافة خطوة
          </button>
        </div>

        {!flow?.id && (
          <p className="text-sm text-inbox-muted">
            احفظ المُشغّل أولًا ثم أضف الخطوات.
          </p>
        )}

        {showStepForm && flow?.id && (
          <form
            onSubmit={(e) => void handleAddStep(e)}
            className="mb-4 space-y-2 rounded-lg border border-inbox-border bg-inbox-bg/40 p-3"
          >
            <select
              value={actionType}
              onChange={(e) => {
                const next = e.target.value;
                setActionType(next);
                setActionValue(next === "ai_agent_reply" ? "auto" : "");
              }}
              className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {actionType === "send_text" && (
              <textarea
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                rows={3}
                placeholder="نص الرسالة التلقائية"
                className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              />
            )}

            {actionType === "send_template" && (
              <select
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              >
                <option value="">اختر قالبًا معتمدًا...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}

            {actionType === "assign_to_user" && (
              <select
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              >
                <option value="">اختر موظفًا...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}

            {actionType === "add_tag" && (
              <select
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              >
                <option value="">اختر وسمًا...</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}

            {actionType === "set_status" && (
              <select
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              >
                <option value="">اختر الحالة...</option>
                <option value="open">مفتوحة</option>
                <option value="pending">معلقة</option>
                <option value="closed">مغلقة</option>
              </select>
            )}

            {actionType === "wait" && (
              <input
                type="number"
                min={1}
                max={300}
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                placeholder="عدد الثواني (حد أقصى 300)"
                className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              />
            )}

            {actionType === "ai_agent_reply" && (
              <div className="space-y-2">
                <p className="text-xs text-inbox-muted">
                  يستخدم آخر رسالة من العميل + قاعدة المعرفة. عند ضعف الثقة يحوّل
                  لموظف (pending).
                </p>
                <input
                  value={actionValue || "auto"}
                  onChange={(e) => setActionValue(e.target.value)}
                  className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-inbox-accent px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              حفظ الخطوة
            </button>
          </form>
        )}

        <div className="space-y-2">
          {steps.map((step, index) => (
            <article
              key={step.id}
              className="rounded-lg border border-inbox-border bg-inbox-bg/30 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-inbox-muted">خطوة {index + 1}</p>
                  <p className="break-words text-sm">{actionSummary(step)}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => void moveStep(index, -1)}
                    className="rounded bg-inbox-hover px-2 py-1 text-xs disabled:opacity-40"
                  >
                    أعلى
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === steps.length - 1}
                    onClick={() => void moveStep(index, 1)}
                    className="rounded bg-inbox-hover px-2 py-1 text-xs disabled:opacity-40"
                  >
                    أسفل
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDeleteStep(step.id)}
                    className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-300"
                  >
                    حذف
                  </button>
                </div>
              </div>
            </article>
          ))}
          {flow?.id && steps.length === 0 && (
            <p className="text-sm text-inbox-muted">لا خطوات بعد</p>
          )}
        </div>
      </section>
    </div>
  );
}
