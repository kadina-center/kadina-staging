import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportAudit,
  getAuditPage,
  getAuditStats,
  type AuditLogEntry,
  type AuditStats,
} from "../lib/api";
import { useSocket, type AuditEventSocket } from "../hooks/useSocket";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_STATUS_LABELS,
  ROLE_LABELS,
  SENDER_TYPE_LABELS,
  labelOr,
} from "../lib/uiLabels";

const ACTIONS = [
  "",
  "LOGIN",
  "LOGOUT",
  "CREATE",
  "UPDATE",
  "DELETE",
  "SEND",
  "RETRY",
  "UPLOAD",
  "DOWNLOAD",
  "LOCK",
  "UNLOCK",
  "TAKEOVER",
  "TRANSFER",
  "ASSIGN",
  "START",
  "STOP",
  "EXPORT",
  "PIN",
  "UNPIN",
];

const ENTITIES = [
  "",
  "USER",
  "CONTACT",
  "CONVERSATION",
  "MESSAGE",
  "NOTE",
  "TAG",
  "CRM",
  "CAMPAIGN",
  "FLOW",
  "SETTINGS",
  "APPOINTMENT",
  "LOGIN",
  "LOGOUT",
  "MEDIA",
  "SYSTEM",
];

const STATUSES = ["", "SUCCESS", "FAILED", "WARNING"];

function actionGlyph(action: string): string {
  const map: Record<string, string> = {
    LOGIN: "IN",
    LOGOUT: "OUT",
    CREATE: "+",
    UPDATE: "~",
    DELETE: "x",
    SEND: ">",
    RETRY: "R",
    UPLOAD: "^",
    DOWNLOAD: "v",
    LOCK: "L",
    UNLOCK: "U",
    TAKEOVER: "T",
    TRANSFER: "<>",
    ASSIGN: "A",
    START: ">",
    STOP: "=",
    EXPORT: "E",
    PIN: "P",
    UNPIN: "P-",
  };
  return map[action] || action.slice(0, 2);
}

function statusTone(status: string): string {
  if (status === "FAILED") return "bg-red-500/15 text-red-300";
  if (status === "WARNING") return "bg-amber-500/15 text-amber-300";
  return "bg-emerald-500/15 text-emerald-300";
}

function formatTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("ar", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) {
    return (
      <div>
        <h4 className="mb-1 text-xs font-medium text-inbox-muted">{label}</h4>
        <p className="text-xs text-inbox-muted/70">—</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium text-inbox-muted">{label}</h4>
      <pre className="max-h-48 overflow-auto rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed text-inbox-text">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditCenter() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      action: action || undefined,
      entityType: entityType || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [search, action, entityType, status, from, to]
  );

  const loadStats = useCallback(async () => {
    try {
      setStats(await getAuditStats());
    } catch {
      // non-blocking
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getAuditPage({ ...filters, limit: 40 });
      setItems(page.items);
      setNextCursor(page.nextCursor);
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل السجل");
    } finally {
      setLoading(false);
    }
  }, [filters, loadStats]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getAuditPage({
        ...filters,
        cursor: nextCursor,
        limit: 40,
      });
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل المزيد");
    } finally {
      setLoadingMore(false);
    }
  }, [filters, nextCursor, loadingMore]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const onAuditEvent = useCallback(
    (payload: AuditEventSocket) => {
      const matches =
        (!filters.action || payload.action === filters.action) &&
        (!filters.entityType || payload.entityType === filters.entityType) &&
        (!filters.status || payload.status === filters.status) &&
        (!filters.search ||
          [
            payload.performedByName,
            payload.action,
            payload.entityType,
            payload.entityId,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(filters.search.toLowerCase()));

      if (!matches) {
        void loadStats();
        return;
      }

      setItems((prev) => {
        if (prev.some((x) => x.id === payload.id)) return prev;
        return [
          {
            id: payload.id,
            action: payload.action,
            entityType: payload.entityType,
            entityId: payload.entityId,
            performedByUserId: payload.performedByUserId,
            performedByName: payload.performedByName,
            performedByRole: payload.performedByRole,
            actorType: payload.actorType,
            ipAddress: payload.ipAddress,
            userAgent: payload.userAgent,
            requestId: payload.requestId,
            status: payload.status,
            oldValues: payload.oldValues,
            newValues: payload.newValues,
            metadata: payload.metadata,
            createdAt:
              typeof payload.createdAt === "string"
                ? payload.createdAt
                : new Date(payload.createdAt).toISOString(),
          },
          ...prev,
        ];
      });
      void loadStats();
    },
    [filters, loadStats]
  );

  useSocket({ onAuditEvent });

  const handleExport = async (format: "csv" | "json") => {
    setExporting(format);
    try {
      await exportAudit({ ...filters, format });
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التصدير");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" dir="rtl">
      <div className="shrink-0 border-b border-inbox-border bg-inbox-panel px-4 py-4">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-inbox-text">
              مركز التدقيق
            </h1>
            <p className="mt-1 text-sm text-inbox-muted">
              ماذا حدث في النظام بالكامل — من، متى، ماذا، على أي عنصر، ومن أي
              جهاز
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => void handleExport("csv")}
              className="rounded-lg bg-inbox-hover px-3 py-2 text-sm text-inbox-text disabled:opacity-50"
            >
              {exporting === "csv" ? "..." : "تصدير CSV"}
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => void handleExport("json")}
              className="rounded-lg bg-inbox-hover px-3 py-2 text-sm text-inbox-text disabled:opacity-50"
            >
              {exporting === "json" ? "..." : "تصدير JSON"}
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { label: "عمليات اليوم", value: stats?.totalToday ?? "—" },
            { label: "أخطاء", value: stats?.errors ?? "—" },
            { label: "تحذيرات", value: stats?.warnings ?? "—" },
            { label: "تسجيل دخول", value: stats?.logins ?? "—" },
            { label: "رسائل مرسلة", value: stats?.messagesSent ?? "—" },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-inbox-border bg-inbox-bg/60 px-3 py-3"
            >
              <div className="text-[11px] text-inbox-muted">{card.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-inbox-text">
                {card.value}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث: موظف / عميل / إجراء / رقم"
            className="rounded-lg border border-inbox-border bg-inbox-bg px-3 py-2 text-sm md:col-span-2"
          />
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-lg border border-inbox-border bg-inbox-bg px-3 py-2 text-sm"
          >
            {ACTIONS.map((a) => (
              <option key={a || "all"} value={a}>
                {a ? labelOr(AUDIT_ACTION_LABELS, a) : "كل الإجراءات"}
              </option>
            ))}
          </select>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="rounded-lg border border-inbox-border bg-inbox-bg px-3 py-2 text-sm"
          >
            {ENTITIES.map((a) => (
              <option key={a || "all"} value={a}>
                {a ? labelOr(AUDIT_ENTITY_LABELS, a) : "كل العناصر"}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-inbox-border bg-inbox-bg px-3 py-2 text-sm"
          >
            {STATUSES.map((a) => (
              <option key={a || "all"} value={a}>
                {a ? labelOr(AUDIT_STATUS_LABELS, a) : "كل الحالات"}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border border-inbox-border bg-inbox-bg px-2 py-2 text-sm"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border border-inbox-border bg-inbox-bg px-2 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <p className="text-sm text-inbox-muted">جاري التحميل...</p>
        )}
        {error && (
          <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        {!loading && items.length === 0 && (
          <p className="text-sm text-inbox-muted">لا توجد سجلات مطابقة.</p>
        )}

        <ul className="space-y-2">
          {items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setSelected(row)}
                className="flex w-full items-center gap-3 rounded-xl border border-inbox-border bg-inbox-panel/80 px-3 py-3 text-right transition hover:border-inbox-accent/40 hover:bg-inbox-hover/40"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inbox-hover text-[11px] font-semibold tracking-wide text-inbox-accent">
                  {actionGlyph(row.action)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-inbox-text">
                      {labelOr(AUDIT_ACTION_LABELS, row.action)}
                    </span>
                    <span className="rounded bg-inbox-hover px-1.5 py-0.5 text-[11px] text-inbox-muted">
                      {labelOr(AUDIT_ENTITY_LABELS, row.entityType)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${statusTone(row.status)}`}
                    >
                      {labelOr(AUDIT_STATUS_LABELS, row.status)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-inbox-muted">
                    {row.performedByName ||
                      labelOr(SENDER_TYPE_LABELS, row.actorType, "نظام")}
                    {row.entityId ? ` · ${row.entityId}` : ""}
                  </div>
                </div>
                <time className="shrink-0 text-[11px] text-inbox-muted">
                  {formatTime(row.createdAt)}
                </time>
              </button>
            </li>
          ))}
        </ul>

        {nextCursor && (
          <div className="py-4 text-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              className="rounded-lg bg-inbox-hover px-4 py-2 text-sm disabled:opacity-50"
            >
              {loadingMore ? "جاري التحميل..." : "تحميل المزيد"}
            </button>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-40 flex justify-start">
          <button
            type="button"
            aria-label="إغلاق"
            className="absolute inset-0 bg-black/50"
            onClick={() => setSelected(null)}
          />
          <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-inbox-border bg-inbox-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-inbox-border px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">
                  {labelOr(AUDIT_ACTION_LABELS, selected.action)}
                </h2>
                <p className="text-xs text-inbox-muted">
                  {labelOr(AUDIT_ENTITY_LABELS, selected.entityType)}
                  {selected.entityId ? ` · ${selected.entityId}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md bg-inbox-hover px-2 py-1 text-sm"
              >
                إغلاق
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-inbox-muted">المستخدم</div>
                  <div>{selected.performedByName || "—"}</div>
                </div>
                <div>
                  <div className="text-inbox-muted">الدور</div>
                  <div>
                    {selected.performedByRole
                      ? labelOr(ROLE_LABELS, selected.performedByRole)
                      : labelOr(SENDER_TYPE_LABELS, selected.actorType)}
                  </div>
                </div>
                <div>
                  <div className="text-inbox-muted">الحالة</div>
                  <div className={statusTone(selected.status).split(" ")[1]}>
                    {labelOr(AUDIT_STATUS_LABELS, selected.status)}
                  </div>
                </div>
                <div>
                  <div className="text-inbox-muted">الوقت</div>
                  <div>{formatTime(selected.createdAt)}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-inbox-muted">IP</div>
                  <div className="break-all" dir="ltr">
                    {selected.ipAddress || "—"}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-inbox-muted">وكيل المتصفح</div>
                  <div className="break-all text-[11px]" dir="ltr">
                    {selected.userAgent || "—"}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-inbox-muted">معرّف الطلب</div>
                  <div className="break-all font-mono text-[11px]" dir="ltr">
                    {selected.requestId || "—"}
                  </div>
                </div>
              </div>
              <JsonBlock label="القيم السابقة" value={selected.oldValues} />
              <JsonBlock label="القيم الجديدة" value={selected.newValues} />
              <JsonBlock label="بيانات إضافية" value={selected.metadata} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
