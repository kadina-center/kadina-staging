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
  type InteractiveListSection,
  type Message,
  type Template,
} from "../lib/api";

type Props = {
  disabled?: boolean;
  /** ISO date of last inbound customer message; used for 24h window check */
  lastInboundAt?: string | null;
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
  onSendInteractiveList?: (
    bodyText: string,
    buttonLabel: string,
    sections: InteractiveListSection[]
  ) => Promise<void> | void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const EMOJIS = ["👍", "🙏", "😊", "✅", "❤️", "🎉", "👋", "🙂"];

type ComposerMode = "text" | "template" | "list";

function isOutsideCustomerWindow(lastInboundAt?: string | null): boolean {
  if (!lastInboundAt) return true;
  return Date.now() - new Date(lastInboundAt).getTime() > DAY_MS;
}

function extractParamCount(bodyText: string): number {
  const matches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
  const nums = matches.map((m) => Number(m.replace(/[{}]/g, "")));
  return nums.length ? Math.max(...nums) : 0;
}

function emptySection(): InteractiveListSection {
  return {
    title: "القسم 1",
    rows: [{ id: "row_1", title: "خيار 1", description: "" }],
  };
}

function validateList(
  bodyText: string,
  buttonLabel: string,
  sections: InteractiveListSection[]
): string | null {
  if (!bodyText.trim()) return "نص القائمة مطلوب";
  if (!buttonLabel.trim()) return "عنوان زر القائمة مطلوب";
  if (buttonLabel.trim().length > 20) return "عنوان الزر بحد أقصى 20 حرفًا";
  if (!sections.length) return "أضف قسمًا واحدًا على الأقل";
  if (sections.length > 10) return "الحد الأقصى 10 أقسام";
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  if (totalRows < 1) return "أضف صفًا واحدًا على الأقل";
  if (totalRows > 10) return "الحد الأقصى 10 صفوف إجمالًا";
  const ids = new Set<string>();
  for (const section of sections) {
    if (!section.title.trim()) return "عنوان كل قسم مطلوب";
    if (!section.rows.length) return "كل قسم يحتاج صفًا واحدًا على الأقل";
    for (const row of section.rows) {
      if (!row.id.trim()) return "معرّف كل صف مطلوب";
      if (!row.title.trim()) return "عنوان كل صف مطلوب";
      if (row.title.trim().length > 24) return "عنوان الصف بحد أقصى 24 حرفًا";
      if ((row.description || "").length > 72) {
        return "وصف الصف بحد أقصى 72 حرفًا";
      }
      if (ids.has(row.id.trim())) return "معرّفات الصفوف يجب أن تكون فريدة";
      ids.add(row.id.trim());
    }
  }
  return null;
}

export default function MessageInput({
  disabled,
  lastInboundAt,
  replyTo,
  onClearReply,
  onTypingStart,
  onTypingStop,
  onSend,
  onSendMedia,
  onSendTemplate,
  onSendInteractiveButtons,
  onSendInteractiveList,
}: Props) {
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ComposerMode>("text");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [listBody, setListBody] = useState("");
  const [listButton, setListButton] = useState("اختر");
  const [listSections, setListSections] = useState<InteractiveListSection[]>([
    emptySection(),
  ]);
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
    if (!onTypingStart || !onTypingStop) return;
    onTypingStart();
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      onTypingStop();
    }, 1200);
  }

  const canSubmit = Boolean(
    file ? true : mode === "template" ? templateId : text.trim()
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled || sending) return;
    setSending(true);
    setError(null);
    try {
      if (mode === "template") {
        if (!templateId) throw new Error("اختر قالبًا");
        await onSendTemplate(templateId, params);
        setTemplateId("");
        setParams([]);
      } else if (file) {
        await onSendMedia(file, caption.trim() || undefined);
        clearFile();
      } else {
        const body = text.trim();
        if (!body) return;
        await onSend(body, replyTo?.id);
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

  async function handleSendList() {
    if (!onSendInteractiveList || disabled || sending) return;
    const validationError = validateList(listBody, listButton, listSections);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const cleaned = listSections.map((section) => ({
        title: section.title.trim(),
        rows: section.rows.map((row) => ({
          id: row.id.trim(),
          title: row.title.trim(),
          ...(row.description?.trim()
            ? { description: row.description.trim() }
            : {}),
        })),
      }));
      await onSendInteractiveList(
        listBody.trim(),
        listButton.trim(),
        cleaned
      );
      setListBody("");
      setListButton("اختر");
      setListSections([emptySection()]);
      setMode("text");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إرسال القائمة");
    } finally {
      setSending(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const next = e.dataTransfer.files?.[0];
    if (next) setFile(next);
  }

  const listPreviewRows = listSections.flatMap((s) =>
    s.rows.map((r) => ({ section: s.title, ...r }))
  );

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`border-t border-inbox-border px-3 py-3 ${
        dragOver ? "bg-inbox-accent/10" : "bg-inbox-panel"
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

      {!needsTemplate && (
        <div className="mb-2 flex flex-wrap gap-1">
          {(
            [
              ["text", "نص"],
              ["list", "قائمة"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={disabled || sending || Boolean(file)}
              onClick={() => setMode(key)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                mode === key
                  ? "bg-inbox-accent text-white"
                  : "bg-inbox-hover text-inbox-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

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
      ) : mode === "list" && onSendInteractiveList ? (
        <div className="space-y-2">
          <textarea
            value={listBody}
            onChange={(e) => setListBody(e.target.value)}
            rows={2}
            dir="rtl"
            disabled={disabled || sending}
            placeholder="نص القائمة (Body)"
            className="w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
          />
          <input
            value={listButton}
            onChange={(e) => setListButton(e.target.value)}
            disabled={disabled || sending}
            placeholder="عنوان زر القائمة (CTA)"
            className="w-full rounded-lg bg-inbox-hover px-3 py-2 text-sm outline-none"
            dir="rtl"
          />

          {listSections.map((section, sIdx) => (
            <div
              key={sIdx}
              className="space-y-2 rounded-lg border border-inbox-border bg-inbox-hover/40 p-2"
            >
              <div className="flex gap-2">
                <input
                  value={section.title}
                  onChange={(e) => {
                    const next = [...listSections];
                    next[sIdx] = { ...section, title: e.target.value };
                    setListSections(next);
                  }}
                  placeholder="عنوان القسم"
                  className="min-w-0 flex-1 rounded bg-inbox-panel px-2 py-1 text-xs outline-none"
                />
                <button
                  type="button"
                  disabled={listSections.length <= 1 || disabled || sending}
                  onClick={() =>
                    setListSections((prev) =>
                      prev.filter((_, i) => i !== sIdx)
                    )
                  }
                  className="text-xs text-red-300 disabled:opacity-40"
                >
                  حذف قسم
                </button>
              </div>
              {section.rows.map((row, rIdx) => (
                <div key={rIdx} className="grid gap-1 sm:grid-cols-3">
                  <input
                    value={row.id}
                    onChange={(e) => {
                      const next = [...listSections];
                      const rows = [...section.rows];
                      rows[rIdx] = { ...row, id: e.target.value };
                      next[sIdx] = { ...section, rows };
                      setListSections(next);
                    }}
                    placeholder="row id"
                    dir="ltr"
                    className="rounded bg-inbox-panel px-2 py-1 text-xs outline-none"
                  />
                  <input
                    value={row.title}
                    onChange={(e) => {
                      const next = [...listSections];
                      const rows = [...section.rows];
                      rows[rIdx] = { ...row, title: e.target.value };
                      next[sIdx] = { ...section, rows };
                      setListSections(next);
                    }}
                    placeholder="عنوان الصف"
                    className="rounded bg-inbox-panel px-2 py-1 text-xs outline-none"
                  />
                  <div className="flex gap-1">
                    <input
                      value={row.description || ""}
                      onChange={(e) => {
                        const next = [...listSections];
                        const rows = [...section.rows];
                        rows[rIdx] = { ...row, description: e.target.value };
                        next[sIdx] = { ...section, rows };
                        setListSections(next);
                      }}
                      placeholder="وصف (اختياري)"
                      className="min-w-0 flex-1 rounded bg-inbox-panel px-2 py-1 text-xs outline-none"
                    />
                    <button
                      type="button"
                      disabled={section.rows.length <= 1 || disabled || sending}
                      onClick={() => {
                        const next = [...listSections];
                        next[sIdx] = {
                          ...section,
                          rows: section.rows.filter((_, i) => i !== rIdx),
                        };
                        setListSections(next);
                      }}
                      className="text-xs text-red-300 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                disabled={disabled || sending}
                onClick={() => {
                  const next = [...listSections];
                  next[sIdx] = {
                    ...section,
                    rows: [
                      ...section.rows,
                      {
                        id: `row_${Date.now()}`,
                        title: "خيار جديد",
                        description: "",
                      },
                    ],
                  };
                  setListSections(next);
                }}
                className="text-xs text-inbox-accent"
              >
                + صف
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || sending || listSections.length >= 10}
              onClick={() =>
                setListSections((prev) => [
                  ...prev,
                  {
                    title: `القسم ${prev.length + 1}`,
                    rows: [
                      {
                        id: `row_${Date.now()}`,
                        title: "خيار",
                        description: "",
                      },
                    ],
                  },
                ])
              }
              className="rounded-md bg-inbox-hover px-2 py-1 text-xs disabled:opacity-50"
            >
              + قسم
            </button>
            <button
              type="button"
              disabled={disabled || sending}
              onClick={() => void handleSendList()}
              className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {sending ? "..." : "إرسال القائمة"}
            </button>
          </div>

          <div className="rounded-md border border-inbox-border bg-black/20 p-2 text-xs text-inbox-muted">
            <p className="mb-1 font-medium text-inbox-text">معاينة</p>
            <p className="whitespace-pre-wrap text-inbox-text">
              {listBody || "—"}
            </p>
            <p className="mt-1">الزر: {listButton || "—"}</p>
            <ul className="mt-1 list-disc pe-4">
              {listPreviewRows.map((r, i) => (
                <li key={`${r.id}-${i}`}>
                  [{r.section}] {r.title}
                  {r.description ? ` — ${r.description}` : ""}
                </li>
              ))}
            </ul>
          </div>
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
