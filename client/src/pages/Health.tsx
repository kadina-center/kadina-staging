import { useCallback, useEffect, useState } from "react";
import { getDetailedHealth, type DetailedHealth } from "../lib/api";
import {
  AUDIT_ACTION_LABELS,
  CHANNEL_STATUS_LABELS,
  labelOr,
} from "../lib/uiLabels";

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-inbox-border py-3 text-sm">
      <span className="text-inbox-muted">{label}</span>
      <span
        className={`font-medium ${
          ok === false
            ? "text-red-400"
            : ok === true
              ? "text-emerald-400"
              : "text-inbox-text"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function Health() {
  const [data, setData] = useState<DetailedHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getDetailedHealth());
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل الحالة");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">صحة النظام</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            مراقبة قاعدة البيانات و WhatsApp و Webhook و Socket والطابور
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

      {loading && !data && (
        <p className="text-sm text-inbox-muted">جاري التحميل...</p>
      )}
      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {data && (
        <div className="rounded-xl border border-inbox-border bg-inbox-panel px-4">
          <Row
            label="قاعدة البيانات"
            value={data.db}
            ok={data.db === "up"}
          />
          <Row
            label="WhatsApp API"
            value={
              data.messagingReady || data.whatsapp?.configured
                ? `متصل (${data.whatsapp?.connectedCount ?? "—"}/${data.whatsapp?.activeCount ?? "—"} نشط)`
                : "غير متصل / غير مهيأ"
            }
            ok={Boolean(data.messagingReady ?? data.whatsapp?.configured)}
          />
          <Row
            label="آخر Webhook وارد"
            value={
              data.webhook?.lastInboundAt
                ? new Date(data.webhook.lastInboundAt).toLocaleString("ar")
                : "—"
            }
          />
          <Row
            label="Socket.IO"
            value={`${data.socket?.connectedCount ?? 0} متصل`}
          />
          <Row
            label="الطابور (معلق / فاشل)"
            value={`${data.queue?.pending ?? 0} / ${data.queue?.failed ?? 0}`}
            ok={(data.queue?.failed ?? 0) === 0}
          />
          <Row
            label="رسائل فاشلة"
            value={String(data.messages?.pendingFailed ?? 0)}
            ok={(data.messages?.pendingFailed ?? 0) === 0}
          />
          <Row
            label="طابور الفشل"
            value={String(data.deadLetterMessages ?? 0)}
            ok={(data.deadLetterMessages ?? 0) === 0}
          />
          <Row
            label="أخطاء 24 ساعة"
            value={String(data.systemErrorsLast24h ?? 0)}
          />
          <Row
            label="آخر خطأ"
            value={
              data.lastError
                ? `${data.lastError.source}: ${data.lastError.message.slice(0, 80)}`
                : "—"
            }
            ok={!data.lastError}
          />
          <Row
            label="آخر نسخة احتياطية"
            value={
              data.lastBackup
                ? `${data.lastBackup.name} · ${new Date(data.lastBackup.mtime).toLocaleString("ar")}`
                : "لا يوجد — شغّل npm run backup"
            }
            ok={Boolean(data.lastBackup)}
          />
          <Row
            label="آخر تدقيق"
            value={
              data.lastAuditLog
                ? `${labelOr(AUDIT_ACTION_LABELS, data.lastAuditLog.action)} · ${new Date(data.lastAuditLog.createdAt).toLocaleString("ar")}`
                : "—"
            }
          />
          <Row
            label="الحالة العامة"
            value={
              data.overall === "healthy"
                ? "جاهز"
                : data.overall === "degraded"
                  ? "متدهور (تحقق من واتساب)"
                  : data.ok
                    ? "جاهز"
                    : "غير جاهز"
            }
            ok={data.overall ? data.overall === "healthy" : data.ok}
          />
        </div>
      )}

      {data?.whatsappChannels && data.whatsappChannels.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">أرقام واتساب</h2>
          <div className="rounded-xl border border-inbox-border bg-inbox-panel px-4">
            {data.whatsappChannels.map((ch) => (
              <div
                key={ch.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-inbox-border py-3 text-sm last:border-b-0"
              >
                <div>
                  <span className="font-medium">{ch.displayName}</span>
                  <span className="mr-2 text-xs text-inbox-muted" dir="ltr">
                    ({ch.name})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span
                    className={
                      ch.isActive ? "text-emerald-400" : "text-inbox-muted"
                    }
                  >
                    {ch.isActive ? "نشط" : "معطّل"}
                  </span>
                  <span
                    className={
                      ch.status === "CONNECTED"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    {labelOr(CHANNEL_STATUS_LABELS, ch.status)}
                  </span>
                  <span className="text-inbox-muted">
                    Webhook:{" "}
                    {ch.lastWebhookAt
                      ? new Date(ch.lastWebhookAt).toLocaleString("ar")
                      : "—"}
                  </span>
                  <span className="text-inbox-muted">
                    آخر رسالة:{" "}
                    {ch.lastMessageAt
                      ? new Date(ch.lastMessageAt).toLocaleString("ar")
                      : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
