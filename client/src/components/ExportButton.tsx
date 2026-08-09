import { useState } from "react";
import { exportAnalyticsCsv } from "../lib/api";

type Props = {
  from?: string;
  to?: string;
};

export default function ExportButton({ from, to }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportAnalyticsCsv({ from, to });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "conversations-export.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التصدير");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={busy}
        className="rounded-lg border border-inbox-border bg-inbox-hover px-3 py-2 text-sm hover:bg-inbox-border disabled:opacity-50"
      >
        {busy ? "جاري التصدير..." : "تصدير CSV"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
