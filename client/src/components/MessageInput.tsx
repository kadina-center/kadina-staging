import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  getTemplates,
  type Message,
  type Template,
} from "../lib/api";

type Props = {
  disabled?: boolean;
  /** ISO date of last inbound customer message; used for 24h window check */
  lastInboundAt?: string | null;
  /** Copilot fills the composer — never auto-sends */
  draftText?: string | null;
  onDraftConsumed?: () => void;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  onSend: (text: string, replyToMessageId?: string) => Promise<void> | void;
  onSendMedia: (file: File, caption?: string) => Promise<void> | void;
  onSendTemplate: (
    templateId: string,
    params: string[]
  ) => Promise<void> | void;
  onSendInteractiveButtons?: (
    bodyText: string,
    buttons: Array<{ id: string; title: string }>
  ) => Promise<void> | void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const EMOJIS = ["👍", "🙏", "😊", "✅", "❤️", "🎉", "👋", "🙂"];

function isOutsideCustomerWindow(lastInboundAt?: string | null): boolean {
  if (!lastInboundAt) return true;
  return Date.now() - new Date(lastInboundAt).getTime() > DAY_MS;
}

function extractParamCount(bodyText: string): number {
  const matches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
  const nums = matches.map((m) => Number(m.replace(/[{}]/g, "")));
  return nums.length ? Math.max(...nums) : 0;
}

export default function MessageInput({
  disabled,
  lastInboundAt,
  draftText,
  onDraftConsumed,
  replyTo,
  onClearReply,
  onTypingStart,
  onTypingStop,
  onSend,
  onSendMedia,
  onSendTemplate,
  onSendInteractiveButtons,
}: Props) {
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");

  useEffect(() => {
    if (!draftText) return;
    setText(draftText);
    onDraftConsumed?.();
  }, [draftText, onDraftConsumed]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"text" | "template">("text");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  const needsTemplate = isOutsideCustomerWindow(lastInboundAt);

  useEffect(() => {
    if (!needsTemplate && mode === "template") {
      setMode("text");
    }
  }, [needsTemplate, mode]);

  useEffect(() => {
    if (!needsTemplate) return;
    void getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [needsTemplate]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId]
  );

  useEffect(() => {
    if (!selectedTemplate) {
      setParams([]);
      return;
    }
    setParams(Array(extractParamCount(selectedTemplate.bodyText)).fill(""));
  }, [selectedTemplate]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      onTypingStop?.();
    };
  }, [onTypingStop]);

  function clearFile() {
    setFile(null);
    setCaption("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleTextChange(value: string) {
    setText(value);
    onTypingStart?.();
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      onTypingStop?.();
    }, 1200);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const next = event.dataTransfer.files?.[0];
    if (next) setFile(next);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending || disabled) return;

    setSending(true);
    setError(null);
    try {
      if (mode === "template") {
        if (!templateId) throw new Error("اختر قالبًا معتمدًا");
        if (selectedTemplate && selectedTemplate.status !== "approved") {
          throw new Error(
            "هذا القالب لم يُعتمد من ميتا بعد. حدّث الحالة من صفحة القوالب."
          );
        }
        await onSendTemplate(templateId, params);
        setTemplateId("");
        setParams([]);
      } else if (file) {
        await onSendMedia(file, caption || undefined);
        clearFile();
        setText("");
        onClearReply?.();
      } else {
        const value = text.trim();
        if (!value) return;
        await onSend(value, replyTo?.id);
        setText("");
        onClearReply?.();
      }
      onTypingStop?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الإرسال");
    } finally {
      setSending(false);
    }
  }

  const canSubmit =
    mode === "template"
      ? Boolean(templateId)
      : file
        ? true
        : Boolean(text.trim());

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`border-t border-inbox-border bg-inbox-panel px-3 py-3 ${
        dragOver ? "ring-2 ring-inset ring-inbox-accent" : ""
      }`}
    >
      {needsTemplate && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span>
            نافذة الـ24 ساعة مغلقة — لإرسال رسالة للعميل استخدم قالبًا معتمدًا من
            ميتا.
          </span>
          <button
            type="button"
            onClick={() => setMode(mode === "template" ? "text" : "template")}
            className="rounded bg-amber-500/30 px-2 py-1 hover:bg-amber-500/40"
          >
            {mode === "template" ? "رسالة عادية" : "إرسال قالب"}
          </button>
        </div>
      )}

      {replyTo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-inbox-accent/40 bg-inbox-hover px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="text-inbox-accent">رد على</p>
            <p className="truncate text-inbox-muted">
              {replyTo.content || replyTo.type}
            </p>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="text-inbox-muted hover:text-inbox-text"
          >
            إلغاء
          </button>
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      {mode === "template" ? (
        <div className="space-y-2">
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={disabled || sending}
            className="w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
          >
            <option value="">اختر قالبًا...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.status})
              </option>
            ))}
          </select>
          {selectedTemplate && (
            <p className="text-xs text-inbox-muted">{selectedTemplate.bodyText}</p>
          )}
          {params.map((value, index) => (
            <input
              key={index}
              value={value}
              onChange={(e) => {
                const next = [...params];
                next[index] = e.target.value;
                setParams(next);
              }}
              placeholder={`قيمة {{${index + 1}}}`}
              className="w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
            />
          ))}
          <button
            type="submit"
            disabled={disabled || sending || !canSubmit}
            className="rounded-lg bg-inbox-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? "..." : "إرسال القالب"}
          </button>
        </div>
      ) : (
        <>
          {file && (
            <div className="mb-2 flex items-center gap-3 rounded-lg bg-inbox-hover p-2">
              {previewUrl && file.type.startsWith("image/") ? (
                <img
                  src={previewUrl}
                  alt="معاينة"
                  className="h-14 w-14 rounded object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded bg-inbox-border text-xs">
                  ملف
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{file.name}</p>
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="تعليق اختياري"
                  dir="rtl"
                  className="mt-1 w-full rounded bg-inbox-panel px-2 py-1 text-xs outline-none"
                />
              </div>
              <button
                type="button"
                onClick={clearFile}
                className="text-xs text-red-300 hover:text-red-200"
              >
                إزالة
              </button>
            </div>
          )}

          <div className="mb-2 flex flex-wrap items-center gap-1">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={disabled || sending || Boolean(file)}
                onClick={() => handleTextChange(text + emoji)}
                className="rounded bg-inbox-hover px-2 py-1 text-sm hover:bg-inbox-border disabled:opacity-50"
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
              }}
            />
            <button
              type="button"
              disabled={disabled || sending}
              onClick={() => fileInputRef.current?.click()}
              title="إرفاق ملف"
              className="flex h-11 shrink-0 items-center justify-center rounded-lg bg-inbox-hover px-3 text-xs text-inbox-muted hover:text-inbox-text disabled:opacity-50"
            >
              إرفاق
            </button>
            {onSendInteractiveButtons && (
              <button
                type="button"
                disabled={disabled || sending || Boolean(file) || !text.trim()}
                title="إرسال أزرار تفاعلية"
                onClick={() => {
                  void (async () => {
                    setSending(true);
                    setError(null);
                    try {
                      await onSendInteractiveButtons(text.trim(), [
                        { id: "yes", title: "نعم" },
                        { id: "no", title: "لا" },
                        { id: "call", title: "اتصل بنا" },
                      ]);
                      setText("");
                      onTypingStop?.();
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "فشل إرسال الأزرار"
                      );
                    } finally {
                      setSending(false);
                    }
                  })();
                }}
                className="flex h-11 shrink-0 items-center justify-center rounded-lg bg-inbox-hover px-3 text-xs text-inbox-muted hover:text-inbox-text disabled:opacity-50"
              >
                أزرار
              </button>
            )}
            <textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit(e);
                }
              }}
              rows={1}
              dir="rtl"
              disabled={disabled || sending || Boolean(file)}
              placeholder={
                file
                  ? "أضف تعليقًا أعلاه أو أرسل الملف"
                  : dragOver
                    ? "أفلت الملف هنا..."
                    : "اكتب رسالة..."
              }
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-lg bg-inbox-hover px-3 py-2.5 text-sm text-inbox-text outline-none ring-inbox-accent focus:ring-1 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={disabled || sending || !canSubmit}
              className="rounded-lg bg-inbox-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#029a78] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "..." : "إرسال"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
