import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  activateWhatsAppChannel,
  createWhatsAppChannel,
  deactivateWhatsAppChannel,
  deleteWhatsAppChannel,
  getWhatsAppChannels,
  testWhatsAppChannel,
  updateWhatsAppChannel,
  type WhatsAppChannel,
} from "../lib/api";
import { CHANNEL_STATUS_LABELS, labelOr } from "../lib/uiLabels";

const MAX_CHANNELS = 5;

type FormMode = "create" | "edit" | null;

type FormState = {
  name: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  name: "",
  displayName: "",
  phoneNumber: "",
  phoneNumberId: "",
  accessToken: "",
  businessAccountId: "",
  isActive: true,
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ar");
}

function statusBadge(status: string, isActive: boolean) {
  if (!isActive) {
    return (
      <span className="rounded bg-inbox-border px-2 py-0.5 text-xs text-inbox-muted">
        معطّل
      </span>
    );
  }
  const ok = status === "CONNECTED";
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs ${
        ok
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-red-500/15 text-red-400"
      }`}
    >
      {labelOr(CHANNEL_STATUS_LABELS, status)}
    </span>
  );
}

export default function WhatsAppChannels() {
  const [channels, setChannels] = useState<WhatsAppChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formBusy, setFormBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    status: string;
    message: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChannels(await getWhatsAppChannels());
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل الأرقام");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    if (channels.length >= MAX_CHANNELS) return;
    setForm(emptyForm);
    setEditingId(null);
    setFormMode("create");
    setTestResult(null);
  }

  function openEdit(channel: WhatsAppChannel) {
    setForm({
      name: channel.name,
      displayName: channel.displayName,
      phoneNumber: channel.phoneNumber,
      phoneNumberId: channel.phoneNumberId,
      accessToken: "",
      businessAccountId: channel.businessAccountId || "",
      isActive: channel.isActive,
    });
    setEditingId(channel.id);
    setFormMode("edit");
    setTestResult(null);
  }

  function closeForm() {
    setFormMode(null);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormBusy(true);
    setError(null);
    try {
      if (formMode === "create") {
        if (!form.accessToken.trim()) {
          setError("رمز الوصول مطلوب عند الإنشاء");
          return;
        }
        await createWhatsAppChannel({
          name: form.name.trim(),
          displayName: form.displayName.trim(),
          phoneNumber: form.phoneNumber.trim(),
          phoneNumberId: form.phoneNumberId.trim(),
          accessToken: form.accessToken.trim(),
          businessAccountId: form.businessAccountId.trim() || null,
          isActive: form.isActive,
        });
      } else if (formMode === "edit" && editingId) {
        await updateWhatsAppChannel(editingId, {
          name: form.name.trim(),
          displayName: form.displayName.trim(),
          phoneNumber: form.phoneNumber.trim(),
          phoneNumberId: form.phoneNumberId.trim(),
          ...(form.accessToken.trim()
            ? { accessToken: form.accessToken.trim() }
            : {}),
          businessAccountId: form.businessAccountId.trim() || null,
          isActive: form.isActive,
        });
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحفظ");
    } finally {
      setFormBusy(false);
    }
  }

  async function handleTest(id: string) {
    setActionBusy(id);
    setTestResult(null);
    setError(null);
    try {
      const result = await testWhatsAppChannel(id);
      setTestResult({ id, status: result.status, message: result.message });
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل اختبار الاتصال");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleToggleActive(channel: WhatsAppChannel) {
    setActionBusy(channel.id);
    setError(null);
    try {
      if (channel.isActive) {
        await deactivateWhatsAppChannel(channel.id);
      } else {
        await activateWhatsAppChannel(channel.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تغيير الحالة");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("حذف هذا الرقم؟ لا يمكن الحذف إذا كانت هناك محادثات.")) {
      return;
    }
    setActionBusy(id);
    setError(null);
    try {
      await deleteWhatsAppChannel(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الحذف");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">أرقام واتساب</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            إدارة أرقام واتساب متعددة للعيادة (حتى {MAX_CHANNELS} أرقام)
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-amber-200/90">
            مهم: استخدم Access Token دائم من Meta Business → System Users (وليس
            توكن Graph API Explorer المؤقت). احفظه هنا مرة واحدة؛ لن يُستبدل تلقائيًا
            من Railway ENV بعد الحفظ.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-inbox-hover px-3 py-2 text-sm"
        >
          تحديث
        </button>
      </div>

      {channels.length >= MAX_CHANNELS && (
        <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          وصلت للحد الأقصى ({MAX_CHANNELS} أرقام). احذف رقمًا لإضافة جديد.
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          disabled={channels.length >= MAX_CHANNELS}
          onClick={openCreate}
          className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          إضافة رقم
        </button>
        <span className="text-xs text-inbox-muted">
          {channels.length} / {MAX_CHANNELS}
        </span>
      </div>

      {loading && (
        <p className="text-sm text-inbox-muted">جاري التحميل...</p>
      )}

      {!loading && channels.length === 0 && (
        <p className="rounded-xl border border-inbox-border bg-inbox-panel p-4 text-sm text-inbox-muted">
          لا توجد أرقام واتساب بعد. اضغط «إضافة رقم» للبدء.
        </p>
      )}

      <div className="space-y-3">
        {channels.map((ch) => (
          <div
            key={ch.id}
            className="rounded-xl border border-inbox-border bg-inbox-panel p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{ch.displayName}</h2>
                  {statusBadge(ch.status, ch.isActive)}
                  <span className="text-xs text-inbox-muted" dir="ltr">
                    ({ch.name})
                  </span>
                </div>
                <p className="mt-1 text-sm text-inbox-muted" dir="ltr">
                  {ch.phoneNumber}
                </p>
                <p className="text-xs text-inbox-muted">
                  معرّف رقم الهاتف:{" "}
                  <span dir="ltr">{ch.phoneNumberId}</span>
                </p>
                {ch.businessAccountId && (
                  <p className="text-xs text-inbox-muted">
                    معرّف حساب الأعمال:{" "}
                    <span dir="ltr">{ch.businessAccountId}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={actionBusy === ch.id}
                  onClick={() => openEdit(ch)}
                  className="rounded-md bg-inbox-hover px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  تعديل
                </button>
                <button
                  type="button"
                  disabled={actionBusy === ch.id}
                  onClick={() => void handleTest(ch.id)}
                  className="rounded-md bg-inbox-hover px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  اختبار
                </button>
                <button
                  type="button"
                  disabled={actionBusy === ch.id}
                  onClick={() => void handleToggleActive(ch)}
                  className="rounded-md bg-inbox-hover px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  {ch.isActive ? "تعطيل" : "تفعيل"}
                </button>
                <button
                  type="button"
                  disabled={actionBusy === ch.id}
                  onClick={() => void handleDelete(ch.id)}
                  className="rounded-md bg-red-500/15 px-2.5 py-1 text-xs text-red-400 disabled:opacity-50"
                >
                  حذف
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-1 text-xs text-inbox-muted sm:grid-cols-2">
              <span>آخر Webhook: {formatDate(ch.lastWebhookAt)}</span>
              <span>آخر رسالة: {formatDate(ch.lastMessageAt)}</span>
              <span>تاريخ الإنشاء: {formatDate(ch.createdAt)}</span>
              {ch._count?.conversations != null && (
                <span>المحادثات: {ch._count.conversations}</span>
              )}
            </div>

            {testResult?.id === ch.id && (
              <p
                className={`mt-2 text-xs ${
                  testResult.status === "CONNECTED"
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                {labelOr(CHANNEL_STATUS_LABELS, testResult.status)}:{" "}
                {testResult.message}
              </p>
            )}
          </div>
        ))}
      </div>

      {formMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-inbox-border bg-inbox-panel p-4"
            dir="rtl"
          >
            <h2 className="mb-4 font-semibold">
              {formMode === "create" ? "إضافة رقم واتساب" : "تعديل رقم واتساب"}
            </h2>

            <div className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span className="text-inbox-muted">الاسم الداخلي</span>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  required
                  className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
                  dir="ltr"
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="text-inbox-muted">اسم العرض</span>
                <input
                  value={form.displayName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                  required
                  className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="text-inbox-muted">رقم الهاتف</span>
                <input
                  value={form.phoneNumber}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phoneNumber: e.target.value }))
                  }
                  required
                  className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
                  dir="ltr"
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="text-inbox-muted">معرّف رقم الهاتف</span>
                <input
                  value={form.phoneNumberId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phoneNumberId: e.target.value }))
                  }
                  required
                  className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
                  dir="ltr"
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="text-inbox-muted">رمز الوصول</span>
                <input
                  type="password"
                  value={form.accessToken}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, accessToken: e.target.value }))
                  }
                  placeholder={
                    formMode === "edit"
                      ? "اتركه فارغًا للإبقاء"
                      : "مطلوب"
                  }
                  required={formMode === "create"}
                  className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
                  dir="ltr"
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="text-inbox-muted">
                  معرّف حساب WhatsApp Business (اختياري)
                </span>
                <input
                  value={form.businessAccountId}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      businessAccountId: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
                  dir="ltr"
                />
              </label>

              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">نشط</span>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, isActive: e.target.checked }))
                  }
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={formBusy}
                className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {formBusy ? "..." : "حفظ"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg bg-inbox-hover px-4 py-2 text-sm"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
