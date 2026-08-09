import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useSocket,
  type TimelineEventSocket,
} from "../hooks/useSocket";
import {
  getContactTimeline,
  type TimelineEvent,
  type TimelineFilter,
} from "../lib/api";
import { SENDER_TYPE_LABELS, labelOr } from "../lib/uiLabels";

type Props = {
  contactId: string | null;
};

const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "messages", label: "الرسائل" },
  { key: "crm", label: "CRM" },
  { key: "appointments", label: "المواعيد" },
  { key: "campaigns", label: "الحملات" },
  { key: "automation", label: "الأتمتة" },
  { key: "ai", label: "AI" },
  { key: "notes", label: "الملاحظات" },
  { key: "system", label: "النظام" },
];

function eventIcon(eventType: string, actorType: string): string {
  if (actorType === "AI") return "✨";
  if (actorType === "BOT" || actorType === "AUTOMATION") return "🤖";
  if (eventType.startsWith("MESSAGE_")) return "💬";
  if (eventType.startsWith("NOTE_")) return "📝";
  if (eventType.startsWith("TAG_") || eventType.startsWith("CRM_")) return "🏷";
  if (eventType.startsWith("APPOINTMENT_")) return "📅";
  if (eventType.startsWith("CAMPAIGN_")) return "📣";
  if (
    eventType.startsWith("FLOW_") ||
    eventType.includes("WELCOME") ||
    eventType.includes("AWAY")
  )
    return "⚙";
  if (eventType.startsWith("CONVERSATION_")) return "🗂";
  return "•";
}

function formatWhen(value: string): string {
  const d = new Date(value);
  return d.toLocaleString("ar-SA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type DisplayItem =
  | { kind: "single"; event: TimelineEvent }
  | {
      kind: "group";
      id: string;
      events: TimelineEvent[];
      eventType: string;
      actorType: string;
      performedByName: string | null;
      createdAt: string;
    };

/** Group consecutive MESSAGE_* events from same actor within 3 minutes */
function groupEvents(events: TimelineEvent[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < events.length) {
    const cur = events[i];
    const isMsg = cur.eventType.startsWith("MESSAGE_");
    if (!isMsg) {
      out.push({ kind: "single", event: cur });
      i += 1;
      continue;
    }
    const batch = [cur];
    let j = i + 1;
    while (j < events.length) {
      const next = events[j];
      if (!next.eventType.startsWith("MESSAGE_")) break;
      if (
        (next.performedByName || "") !== (cur.performedByName || "") ||
        next.actorType !== cur.actorType
      )
        break;
      const gap =
        Math.abs(
          new Date(cur.createdAt).getTime() - new Date(next.createdAt).getTime()
        );
      if (gap > 3 * 60 * 1000) break;
      batch.push(next);
      j += 1;
    }
    if (batch.length === 1) {
      out.push({ kind: "single", event: cur });
    } else {
      out.push({
        kind: "group",
        id: `g-${cur.id}`,
        events: batch,
        eventType: cur.eventType,
        actorType: cur.actorType,
        performedByName: cur.performedByName,
        createdAt: cur.createdAt,
      });
    }
    i = j;
  }
  return out;
}

function MetadataExpand({ metadata }: { metadata: unknown }) {
  const [open, setOpen] = useState(false);
  if (!metadata || typeof metadata !== "object") return null;
  const entries = Object.entries(metadata as Record<string, unknown>);
  if (!entries.length) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-inbox-accent hover:underline"
      >
        {open ? "إخفاء التفاصيل" : "عرض التفاصيل"}
      </button>
      {open && (
        <dl className="mt-1 space-y-0.5 rounded-md bg-black/20 px-2 py-1.5 text-[11px] text-inbox-muted">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 font-medium text-inbox-text">{k}</dt>
              <dd className="min-w-0 break-all">
                {typeof v === "string" ? v : JSON.stringify(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function CustomerTimeline({ contactId }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      if (!contactId) return;
      if (opts?.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const page = await getContactTimeline(contactId, {
          cursor: opts?.cursor || undefined,
          limit: 30,
          filter,
          search: search || undefined,
        });
        setEvents((prev) =>
          opts?.append ? [...prev, ...page.items] : page.items
        );
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "فشل تحميل السجل الزمني"
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [contactId, filter, search]
  );

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    if (contactId) void load();
  }, [contactId, filter, search, load]);

  const onTimelineEvent = useCallback(
    (payload: TimelineEventSocket) => {
      if (!contactId || payload.contactId !== contactId) return;
      // Respect active filter lightly — still show if all
      setEvents((prev) => {
        if (prev.some((e) => e.id === payload.id)) return prev;
        return [
          {
            id: payload.id,
            contactId: payload.contactId,
            conversationId: payload.conversationId,
            eventType: payload.eventType,
            title: payload.title,
            description: payload.description,
            performedByUserId: payload.performedByUserId,
            performedByName: payload.performedByName,
            performedByRole: payload.performedByRole,
            actorType: payload.actorType,
            metadata: payload.metadata,
            createdAt:
              typeof payload.createdAt === "string"
                ? payload.createdAt
                : new Date(payload.createdAt).toISOString(),
          },
          ...prev,
        ];
      });
    },
    [contactId]
  );

  useSocket({ onTimelineEvent });

  const grouped = useMemo(() => groupEvents(events), [events]);

  if (!contactId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-inbox-muted">
        اختر محادثة لعرض السجل الزمني
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b141a]" dir="rtl">
      <div className="shrink-0 space-y-2 border-b border-inbox-border bg-inbox-panel px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-inbox-text">
            السجل الزمني للعميل
          </h3>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-inbox-accent hover:underline"
          >
            تحديث
          </button>
        </div>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setSearch(searchInput.trim());
          }}
          placeholder="بحث في السجل الزمني..."
          className="w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none ring-inbox-accent focus:ring-1"
        />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                filter === f.key
                  ? "bg-inbox-accent text-white"
                  : "bg-inbox-hover text-inbox-muted hover:text-inbox-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-panel min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <p className="text-sm text-inbox-muted">جاري التحميل...</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && !error && events.length === 0 && (
          <p className="text-sm text-inbox-muted">لا توجد أحداث بعد</p>
        )}

        <ol className="relative space-y-0 border-r border-inbox-border/60 pr-4">
          {grouped.map((item) => {
            if (item.kind === "group") {
              return (
                <li key={item.id} className="relative pb-4">
                  <span className="absolute -right-[21px] top-2 flex h-6 w-6 items-center justify-center rounded-full bg-inbox-panel text-xs ring-2 ring-inbox-border">
                    {eventIcon(item.eventType, item.actorType)}
                  </span>
                  <article className="rounded-xl border border-inbox-border bg-inbox-panel/80 p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-inbox-text">
                          {item.events.length} رسائل متتالية
                        </p>
                        <p className="text-xs text-inbox-muted">
                          {item.performedByName ||
                            labelOr(SENDER_TYPE_LABELS, item.actorType)}{" "}
                          · {labelOr(SENDER_TYPE_LABELS, item.actorType)}
                        </p>
                      </div>
                      <time className="shrink-0 text-[11px] text-inbox-muted">
                        {formatWhen(item.createdAt)}
                      </time>
                    </div>
                    <ul className="mt-2 space-y-1.5 border-t border-inbox-border/50 pt-2">
                      {item.events.map((ev) => (
                        <li
                          key={ev.id}
                          className="rounded-md bg-black/15 px-2 py-1.5 text-xs"
                        >
                          <p className="font-medium text-inbox-text">
                            {ev.title}
                          </p>
                          {ev.description && (
                            <p className="mt-0.5 text-inbox-muted">
                              {ev.description}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </article>
                </li>
              );
            }

            const ev = item.event;
            return (
              <li key={ev.id} className="relative pb-4">
                <span className="absolute -right-[21px] top-2 flex h-6 w-6 items-center justify-center rounded-full bg-inbox-panel text-xs ring-2 ring-inbox-border">
                  {eventIcon(ev.eventType, ev.actorType)}
                </span>
                <article className="rounded-xl border border-inbox-border bg-inbox-panel/80 p-3 shadow-sm transition hover:border-inbox-accent/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-inbox-text">
                        {ev.title}
                      </p>
                      {ev.description && (
                        <p className="mt-1 text-xs leading-5 text-inbox-muted">
                          {ev.description}
                        </p>
                      )}
                      <p className="mt-2 text-[11px] text-inbox-muted">
                        <span className="text-inbox-text">
                          {ev.performedByName || "—"}
                        </span>
                        {" · "}
                        {labelOr(SENDER_TYPE_LABELS, ev.actorType)}
                      </p>
                    </div>
                    <time className="shrink-0 text-[11px] text-inbox-muted">
                      {formatWhen(ev.createdAt)}
                    </time>
                  </div>
                  <MetadataExpand metadata={ev.metadata} />
                </article>
              </li>
            );
          })}
        </ol>

        {nextCursor && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void load({ cursor: nextCursor, append: true })}
            className="mt-2 w-full rounded-lg bg-inbox-hover py-2 text-sm text-inbox-text hover:bg-inbox-border disabled:opacity-50"
          >
            {loadingMore ? "..." : "تحميل المزيد"}
          </button>
        )}
      </div>
    </div>
  );
}
