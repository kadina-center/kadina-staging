import { useCallback, useEffect, useMemo, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import {
  cancelCampaign,
  getCampaign,
  getCampaignAnalytics,
  pauseCampaign,
  resumeCampaign,
  retryFailedCampaign,
  sendCampaign,
  type CampaignAnalytics,
  type CampaignDetail,
  type CampaignProgressEvent,
} from "../lib/api";

type Props = {
  campaignId: string;
  onBack: () => void;
};

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "قيد الانتظار",
    sending: "جارٍ الإرسال",
    sent: "أُرسلت",
    delivered: "تم التسليم",
    read: "قُرئت",
    failed: "فشلت",
    cancelled: "ملغاة",
    draft: "مسودة",
    scheduled: "مجدولة",
    paused: "متوقفة",
    completed: "مكتملة",
    replied: "تم الرد",
  };
  return map[status] || status;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "draft":
      return "bg-slate-700 text-slate-100";
    case "scheduled":
      return "bg-sky-900/60 text-sky-200";
    case "sending":
      return "bg-amber-900/50 text-amber-200";
    case "paused":
      return "bg-orange-900/50 text-orange-200";
    case "completed":
      return "bg-emerald-900/50 text-emerald-200";
    case "cancelled":
      return "bg-zinc-700 text-zinc-200";
    case "failed":
      return "bg-red-900/50 text-red-200";
    default:
      return "bg-inbox-hover text-inbox-text";
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
}

function fmtPctOf(n: number, total: number): string {
  if (!total) return "0%";
  const p = (n / total) * 100;
  return `${p.toFixed(p >= 10 ? 0 : 1)}%`;
}

export default function CampaignReport({ campaignId, onBack }: Props) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [detail, stats] = await Promise.all([
        getCampaign(campaignId),
        getCampaignAnalytics(campaignId),
      ]);
      setCampaign(detail);
      setAnalytics(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التحميل");
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleProgress = useCallback(
    (payload: CampaignProgressEvent) => {
      if (payload.campaignId !== campaignId) return;

      setCampaign((prev) => {
        if (!prev) return prev;

        const recipients = prev.recipients.map((r) => {
          if (payload.recipientId && r.id === payload.recipientId) {
            if (payload.recipientStatus === "replied") {
              return {
                ...r,
                repliedAt: r.repliedAt || new Date().toISOString(),
              };
            }
            return {
              ...r,
              status: payload.recipientStatus || r.status,
              waMessageId: payload.waMessageId ?? r.waMessageId,
              errorMessage: payload.error ?? r.errorMessage,
            };
          }
          return r;
        });

        return {
          ...prev,
          status: payload.status || prev.status,
          recipients,
          stats: {
            total: payload.total ?? prev.stats.total,
            counts: payload.counts ?? prev.stats.counts,
            funnel: payload.funnel ?? prev.stats.funnel,
            rates: payload.rates ?? prev.stats.rates,
          },
        };
      });
    },
    [campaignId]
  );

  useSocket({ onCampaignProgress: handleProgress });

  const funnel = useMemo(() => {
    if (!campaign) {
      return { sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, total: 0 };
    }
    const total = campaign.stats.total || campaign.recipients.length || 0;
    if (campaign.stats.funnel) {
      return { ...campaign.stats.funnel, total };
    }
    const c = campaign.stats.counts;
    return {
      total,
      sent: (c.sent || 0) + (c.delivered || 0) + (c.read || 0),
      delivered: (c.delivered || 0) + (c.read || 0),
      read: c.read || 0,
      failed: c.failed || 0,
      replied: c.replied || 0,
    };
  }, [campaign]);

  const progress = useMemo(() => {
    if (!funnel.total) return 0;
    const done = funnel.sent + funnel.failed;
    return Math.min(100, Math.round((done / funnel.total) * 100));
  }, [funnel]);

  async function runAction(fn: () => Promise<unknown>, failMsg: string) {
    setBusy(true);
    setError(null);
    setConfirmCancel(false);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : failMsg);
    } finally {
      setBusy(false);
    }
  }

  if (!campaign) {
    return (
      <div className="p-6" dir="rtl">
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : (
          <p className="text-inbox-muted">جاري التحميل...</p>
        )}
      </div>
    );
  }

  const status = campaign.status;
  const failedCount = campaign.stats.counts.failed || 0;

  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-2 text-xs text-inbox-muted hover:text-inbox-text"
          >
            ← رجوع للحملات
          </button>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-inbox-muted">
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
            >
              {statusLabel(status)}
            </span>
            <span>
              القالب <span dir="ltr">{campaign.template.name}</span>
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(status === "draft" || status === "scheduled" || status === "failed") && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction(() => sendCampaign(campaignId), "فشل بدء الإرسال")
              }
              className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "..." : "بدء"}
            </button>
          )}
          {status === "sending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction(() => pauseCampaign(campaignId), "فشل الإيقاف")
              }
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              إيقاف مؤقت
            </button>
          )}
          {status === "paused" && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction(() => resumeCampaign(campaignId), "فشل الاستئناف")
              }
              className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              استئناف
            </button>
          )}
          {["draft", "scheduled", "sending", "paused", "failed"].includes(
            status
          ) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
              className="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
            >
              إلغاء
            </button>
          )}
          {failedCount > 0 &&
            !["cancelled", "draft", "scheduled"].includes(status) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () => retryFailedCampaign(campaignId),
                    "فشل إعادة المحاولة"
                  )
                }
                className="rounded-lg bg-inbox-hover px-4 py-2 text-sm disabled:opacity-50"
              >
                إعادة الفاشلة ({failedCount})
              </button>
            )}
        </div>
      </div>

      {confirmCancel && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm">
          <p className="mb-3">
            تأكيد إلغاء الحملة؟ لن يُرسل للمستلمين المتبقين. لا يمكن التراجع.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction(() => cancelCampaign(campaignId), "فشل الإلغاء")
              }
              className="rounded-lg bg-red-700 px-3 py-1.5 text-white disabled:opacity-50"
            >
              تأكيد الإلغاء
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmCancel(false)}
              className="rounded-lg bg-inbox-hover px-3 py-1.5"
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="المستلمون"
          value={String(funnel.total)}
          sub="الإجمالي"
        />
        <StatCard
          label="أُرسلت"
          value={`${funnel.sent}`}
          sub={fmtPctOf(funnel.sent, funnel.total)}
        />
        <StatCard
          label="تسليم"
          value={`${funnel.delivered}`}
          sub={fmtPctOf(funnel.delivered, funnel.total)}
        />
        <StatCard
          label="قراءة"
          value={`${funnel.read}`}
          sub={fmtPctOf(funnel.read, funnel.total)}
        />
        <StatCard
          label="فشل"
          value={`${funnel.failed}`}
          sub={fmtPctOf(funnel.failed, funnel.total)}
        />
        <StatCard
          label="ردود"
          value={`${funnel.replied}`}
          sub={fmtPctOf(funnel.replied, funnel.total)}
        />
      </div>

      {analytics && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <p className="text-xs text-inbox-muted">معدل التسليم</p>
            <p className="mt-2 text-xl font-semibold">
              {pct(analytics.deliveryRate)}
            </p>
          </div>
          <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <p className="text-xs text-inbox-muted">معدل القراءة</p>
            <p className="mt-2 text-xl font-semibold">
              {pct(analytics.readRate)}
            </p>
          </div>
          <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <p className="text-xs text-inbox-muted">معدل الفشل</p>
            <p className="mt-2 text-xl font-semibold">
              {pct(analytics.failureRate)}
            </p>
          </div>
          <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <p className="text-xs text-inbox-muted">معدل الرد</p>
            <p className="mt-2 text-xl font-semibold">
              {pct(
                analytics.replyRate ??
                  (funnel.total ? funnel.replied / funnel.total : 0)
              )}
            </p>
          </div>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-inbox-border bg-inbox-panel p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span>التقدم</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-inbox-hover">
          <div
            className="h-full bg-inbox-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-inbox-muted">
          <span>معلّق: {campaign.stats.counts.pending || 0}</span>
          <span>ملغى: {campaign.stats.counts.cancelled || 0}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-inbox-border">
        <table className="min-w-full text-sm">
          <thead className="bg-inbox-panel text-inbox-muted">
            <tr>
              <th className="px-4 py-3 text-right">الاسم</th>
              <th className="px-4 py-3 text-right">الهاتف</th>
              <th className="px-4 py-3 text-right">الحالة</th>
              <th className="px-4 py-3 text-right">رد</th>
              <th className="px-4 py-3 text-right">خطأ</th>
            </tr>
          </thead>
          <tbody>
            {campaign.recipients.map((r) => (
              <tr key={r.id} className="border-t border-inbox-border">
                <td className="px-4 py-2">{r.contact.name || "—"}</td>
                <td className="px-4 py-2" dir="ltr">
                  {r.contact.phone}
                </td>
                <td className="px-4 py-2">{statusLabel(r.status)}</td>
                <td className="px-4 py-2 text-xs">
                  {r.repliedAt
                    ? new Date(r.repliedAt).toLocaleString("ar-SA")
                    : "—"}
                </td>
                <td className="max-w-xs truncate px-4 py-2 text-xs text-red-300">
                  {r.errorMessage || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
      <p className="text-xs text-inbox-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-inbox-muted">{sub}</p>
    </div>
  );
}
