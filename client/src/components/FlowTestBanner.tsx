import { useCallback, useEffect, useState } from "react";
import {
  getActiveFlow,
  stopContactFlow,
  type ActiveFlowInfo,
} from "../lib/api";

type Props = {
  contactId: string | null;
};

export default function FlowTestBanner({ contactId }: Props) {
  const [info, setInfo] = useState<ActiveFlowInfo>({ active: false });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!contactId) {
      setInfo({ active: false });
      return;
    }
    try {
      setInfo(await getActiveFlow(contactId));
    } catch {
      setInfo({ active: false });
    }
  }, [contactId]);

  useEffect(() => {
    void refresh();
    if (!contactId) return;
    // Was 4s and hammered the API/DB even when no flow is active.
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [contactId, refresh]);

  async function handleStop() {
    if (!contactId) return;
    setBusy(true);
    try {
      await stopContactFlow(contactId);
      setInfo({ active: false });
    } finally {
      setBusy(false);
    }
  }

  if (!info.active) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm text-sky-100">
      <p>
        هذه المحادثة تحت إدارة الروبوت الآلي حاليًا
        {info.flow?.name ? ` (${info.flow.name})` : ""}.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleStop()}
        className="rounded-md bg-sky-500/30 px-3 py-1.5 text-xs hover:bg-sky-500/40 disabled:opacity-50"
      >
        إيقاف والتدخل يدويًا
      </button>
    </div>
  );
}
