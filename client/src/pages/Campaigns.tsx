import { useCallback, useEffect, useState } from "react";
import { getCampaigns, type CampaignSummary } from "../lib/api";

type Props = {
  onCreate: () => void;
  onOpenReport: (campaignId: string) => void;
};

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "مسودة",
    scheduled: "مجدولة",
    sending: "جارٍ الإرسال",
    completed: "مكتملة",
    failed: "فشلت",
  };
  return map[status] || status;
}

export default function Campaigns({ onCreate, onOpenReport }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setCampaigns(await getCampaigns());
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التحميل");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">الحملات الجماعية</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            إرسال قوالب معتمدة على دفعات مع احترام حدود ميتا
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-lg bg-inbox-accent px-4 py-2 text-sm font-medium text-white"
        >
          حملة جديدة
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-inbox-muted">جاري التحميل...</p>}

      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-inbox-border">
          <table className="min-w-full text-sm">
            <thead className="bg-inbox-panel text-inbox-muted">
              <tr>
                <th className="px-4 py-3 text-right font-medium">الاسم</th>
                <th className="px-4 py-3 text-right font-medium">القالب</th>
                <th className="px-4 py-3 text-right font-medium">المستلمون</th>
                <th className="px-4 py-3 text-right font-medium">الحالة</th>
                <th className="px-4 py-3 text-right font-medium">تاريخ الإنشاء</th>
                <th className="px-4 py-3 text-right font-medium">تقرير</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-inbox-muted"
                  >
                    لا توجد حملات بعد
                  </td>
                </tr>
              )}
              {campaigns.map((campaign) => (
                <tr
                  key={campaign.id}
                  className="border-t border-inbox-border bg-inbox-bg/40"
                >
                  <td className="px-4 py-3 font-medium">{campaign.name}</td>
                  <td className="px-4 py-3" dir="ltr">
                    {campaign.template.name}
                  </td>
                  <td className="px-4 py-3">{campaign.recipientCount}</td>
                  <td className="px-4 py-3">{statusLabel(campaign.status)}</td>
                  <td className="px-4 py-3 text-inbox-muted">
                    {new Date(campaign.createdAt).toLocaleString("ar-SA")}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpenReport(campaign.id)}
                      className="rounded-md bg-inbox-hover px-2 py-1 text-xs hover:bg-inbox-border"
                    >
                      عرض
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
