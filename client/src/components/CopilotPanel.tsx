import { useCallback, useEffect, useState } from "react";
import { getCopilotSuggestions } from "../lib/api";

type Props = {
  conversationId: string | null;
  onPick: (text: string) => void;
};

/**
 * AI Copilot — suggestions only.
 * Clicking a card fills MessageInput; the human agent must press Send.
 */
export default function CopilotPanel({ conversationId, onPick }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getCopilotSuggestions({ conversationId });
      setSuggestions(result.suggestions);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "فشل جلب الاقتراحات";
      // Soften missing-AI noise; keep refresh available.
      setError(
        /غير مفعّل|ANTHROPIC|503|AI/i.test(msg)
          ? "المساعد الذكي غير مفعّل حاليًا"
          : msg
      );
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!conversationId) return null;

  return (
    <div className="border-t border-inbox-border bg-inbox-panel/80 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-inbox-muted">
          اقتراحات المساعد (لا تُرسل تلقائيًا)
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[11px] text-inbox-accent hover:underline"
        >
          تحديث
        </button>
      </div>
      {loading && (
        <p className="text-xs text-inbox-muted">جاري توليد اقتراحات...</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="max-w-full rounded-lg border border-inbox-border bg-inbox-hover px-3 py-2 text-right text-xs leading-5 text-inbox-text transition hover:border-inbox-accent"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
