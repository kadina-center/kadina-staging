import { useCallback, useEffect, useMemo, useState } from "react";
import { useSocket } from "../hooks/useSocket";
import {
  getCampaign,
  getCampaignAnalytics,
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
    sent: "أُرسلت",
    delivered: "تم التسليم",
    read: "قُرئت",
    failed: "فشلت",
    draft: "مسودة",
    scheduled: "مجدولة",
    sending: "جارٍ الإرسال",
    completed: "مكتملة",
  };
  return map[status] || status;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function CampaignReport({ campaignId, onBack }: Props) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          },
        };
      });
    },
    [campaignId]
  );

  useSocket({ onCampaignProgress: handleProgress });

  const progress = useMemo(() => {
    if (!campaign) return 0;
    const total = campaign.stats.total || campaign.recipients.length || 1;
    const done =
      (campaign.stats.counts.sent || 0) +
      (campaign.stats.counts.delivered || 0) +
      (campaign.stats.counts.read || 0) +
      (campaign.stats.counts.failed || 0);
    return Math.min(100, Math.round((done / total) * 100));
  }, [campaign]);

  async function handleSend() {
    setBusy(true);
    setError(null);
    try {
      await sendCampaign(campaignId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل بدء الإرسال");
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

  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-2 text-xs text-inbox-muted hover:text-inbox-text"
          >
            ← رجوع للحملات
          </button>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            {statusLabel(campaign.status)} · القالب{" "}
            <span dir="ltr">{campaign.template.name}</span>
          </p>
        </div>
        {(campaign.status === "draft" || campaign.status === "scheduled") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSend()}
            className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "..." : "بدء الإرسال"}
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {analytics && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <p className="text-xs text-inbox-muted">معدل التسليم</p>
            <p className="mt-2 text-2xl font-semibold">
              {pct(analytics.deliveryRate)}
            </p>
          </div>
          <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <p className="text-xs text-inbox-muted">معدل القراءة</p>
            <p className="mt-2 text-2xl font-semibold">
              {pct(analytics.readRate)}
            </p>
          </div>
          <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <p className="text-xs text-inbox-muted">معدل الفشل</p>
            <p className="mt-2 text-2xl font-semibold">
              {pct(analytics.failureRate)}
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
          <span>الإجمالي: {campaign.stats.total}</span>
          <span>أُرسلت: {campaign.stats.counts.sent || 0}</span>
          <span>تسليم: {campaign.stats.counts.delivered || 0}</span>
          <span>قراءة: {campaign.stats.counts.read || 0}</span>
          <span>فشل: {campaign.stats.counts.failed || 0}</span>
          <span>معلّق: {campaign.stats.counts.pending || 0}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-inbox-border">
        <table className="min-w-full text-sm">
          <thead className="bg-inbox-panel text-inbox-muted">
            <tr>
              <th className="px-4 py-3 text-right">الاسم</th>
              <th className="px-4 py-3 text-right">الهاتف</th>
              <th className="px-4 py-3 text-right">الحالة</th>
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
