import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ExportButton from "../components/ExportButton";
import { getAnalyticsOverview, type AnalyticsOverview } from "../lib/api";

type Preset = "today" | "7d" | "30d" | "custom";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 60) return `${value.toFixed(1)} د`;
  return `${(value / 60).toFixed(1)} س`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function Analytics() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const now = new Date();
    if (preset === "today") {
      return {
        from: startOfDay(now).toISOString(),
        to: endOfDay(now).toISOString(),
      };
    }
    if (preset === "30d") {
      const from = startOfDay(new Date(now.getTime() - 29 * 86400000));
      return { from: from.toISOString(), to: endOfDay(now).toISOString() };
    }
    if (preset === "custom" && customFrom && customTo) {
      return {
        from: startOfDay(new Date(customFrom)).toISOString(),
        to: endOfDay(new Date(customTo)).toISOString(),
      };
    }
    const from = startOfDay(new Date(now.getTime() - 6 * 86400000));
    return { from: from.toISOString(), to: endOfDay(now).toISOString() };
  }, [preset, customFrom, customTo]);

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const overview = await getAnalyticsOverview(range);
      if (!signal?.cancelled) setData(overview);
    } catch (err) {
      if (!signal?.cancelled) {
        setError(err instanceof Error ? err.message : "فشل تحميل التحليلات");
      }
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  const tagChartData = useMemo(
    () =>
      (data?.tags || [])
        .filter((t) => t.count > 0)
        .slice(0, 8)
        .map((t) => ({ name: t.name, count: t.count, fill: t.color })),
    [data]
  );

  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">التقارير والتحليلات</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            مؤشرات الأداء من بيانات المراحل السابقة
          </p>
        </div>
        <ExportButton from={range.from} to={range.to} />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(
          [
            ["today", "اليوم"],
            ["7d", "آخر 7 أيام"],
            ["30d", "آخر 30 يوم"],
            ["custom", "نطاق مخصص"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              preset === key
                ? "bg-inbox-accent text-white"
                : "bg-inbox-hover text-inbox-muted"
            }`}
          >
            {label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-md bg-inbox-hover px-2 py-1.5 outline-none"
            />
            <span className="text-inbox-muted">إلى</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-md bg-inbox-hover px-2 py-1.5 outline-none"
            />
          </div>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-inbox-muted">جاري التحميل...</p>}

      {data && !loading && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="إجمالي المحادثات"
              value={String(data.kpis.totalConversations)}
            />
            <KpiCard
              label="متوسط زمن الاستجابة"
              value={formatMinutes(data.kpis.averageResponseMinutes)}
            />
            <KpiCard
              label="نسبة رد الذكاء الاصطناعي"
              value={pct(data.kpis.aiOutboundRatio)}
            />
            <KpiCard
              label="محادثات مفتوحة حاليًا"
              value={String(data.kpis.currentlyOpen)}
            />
          </div>

          <section className="mb-6 rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <h2 className="mb-4 font-semibold">حجم الرسائل اليومي</h2>
            <div className="h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.messageVolume.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3942" />
                  <XAxis dataKey="date" stroke="#8696a0" fontSize={11} />
                  <YAxis stroke="#8696a0" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#111b21",
                      border: "1px solid #2a3942",
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="inbound"
                    name="واردة"
                    stroke="#00a884"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="outbound"
                    name="صادرة"
                    stroke="#53bdeb"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
              <h2 className="mb-4 font-semibold">توزيع الوسوم</h2>
              {tagChartData.length === 0 ? (
                <p className="text-sm text-inbox-muted">لا بيانات وسوم في الفترة</p>
              ) : (
                <div className="h-72" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tagChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a3942" />
                      <XAxis dataKey="name" stroke="#8696a0" fontSize={11} />
                      <YAxis
                        stroke="#8696a0"
                        fontSize={11}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#111b21",
                          border: "1px solid #2a3942",
                        }}
                      />
                      <Bar dataKey="count" name="محادثات" fill="#00a884" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
              <h2 className="mb-4 font-semibold">حالة المحادثات</h2>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between">
                  <span>مفتوحة</span>
                  <span>{data.conversations.statusCounts.open}</span>
                </li>
                <li className="flex justify-between">
                  <span>معلقة</span>
                  <span>{data.conversations.statusCounts.pending}</span>
                </li>
                <li className="flex justify-between">
                  <span>مغلقة</span>
                  <span>{data.conversations.statusCounts.closed}</span>
                </li>
                <li className="flex justify-between text-inbox-muted">
                  <span>صادرة بشرية / آلية</span>
                  <span>
                    {data.messageVolume.totals.outboundHuman} /{" "}
                    {data.messageVolume.totals.outboundAi}
                  </span>
                </li>
              </ul>
            </section>
          </div>

          <section className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
            <h2 className="mb-4 font-semibold">أداء الفريق</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-inbox-muted">
                  <tr>
                    <th className="px-3 py-2 text-right">الموظف</th>
                    <th className="px-3 py-2 text-right">المحادثات</th>
                    <th className="px-3 py-2 text-right">متوسط الاستجابة</th>
                    <th className="px-3 py-2 text-right">المغلقة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-6 text-center text-inbox-muted"
                      >
                        لا موظفين بعد
                      </td>
                    </tr>
                  )}
                  {data.team.map((row) => (
                    <tr key={row.userId} className="border-t border-inbox-border">
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">{row.conversationsHandled}</td>
                      <td className="px-3 py-2">
                        {formatMinutes(row.averageResponseMinutes)}
                      </td>
                      <td className="px-3 py-2">{row.conversationsClosed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
      <p className="text-xs text-inbox-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
