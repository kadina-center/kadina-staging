import { useEffect, useMemo, useState } from "react";
import {
  createCampaign,
  createContactList,
  getContactLists,
  getTemplates,
  getWhatsAppChannelsPublic,
  importContactListCsv,
  sendCampaign,
  type ContactListSummary,
  type Template,
  type WhatsAppChannelSummary,
} from "../lib/api";

type Props = {
  onDone: (campaignId: string) => void;
  onCancel: () => void;
};

export default function CampaignBuilder({ onDone, onCancel }: Props) {
  const [step, setStep] = useState(1);
  const [lists, setLists] = useState<ContactListSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [channels, setChannels] = useState<WhatsAppChannelSummary[]>([]);
  const [listId, setListId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [newListName, setNewListName] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      getContactLists(),
      getTemplates(),
      getWhatsAppChannelsPublic(),
    ])
      .then(([l, t, ch]) => {
        setLists(l);
        setTemplates(t.filter((x) => x.status === "approved"));
        const active = ch.filter((c) => c.isActive);
        setChannels(active);
        if (active.length === 1) setChannelId(active[0].id);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "فشل التحميل");
      });
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId]
  );

  const selectedList = useMemo(
    () => lists.find((l) => l.id === listId) ?? null,
    [lists, listId]
  );

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === channelId) ?? null,
    [channels, channelId]
  );

  async function handleCreateListWithCsv() {
    if (!newListName.trim() || !csvFile) {
      setError("أدخل اسم القائمة واختر ملف CSV");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createContactList(newListName.trim());
      const imported = await importContactListCsv(created.id, csvFile);
      const refreshed = await getContactLists();
      setLists(refreshed);
      setListId(created.id);
      setNewListName("");
      setCsvFile(null);
      if (imported.imported === 0) {
        setError("تم إنشاء القائمة لكن لم يُستورد أي رقم صالح");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء القائمة");
    } finally {
      setBusy(false);
    }
  }

  async function handleLaunch(sendNow: boolean) {
    if (!name.trim() || !listId || !templateId || !channelId) {
      setError("أكمل الاسم والقائمة والقالب ورقم واتساب");
      return;
    }
    if (!selectedTemplate || selectedTemplate.status !== "approved") {
      setError("يجب اختيار قالب معتمد من ميتا فقط");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const campaign = await createCampaign({
        name: name.trim(),
        templateId,
        contactListId: listId,
        channelId,
        scheduledAt:
          !sendNow && scheduledAt
            ? new Date(scheduledAt).toISOString()
            : null,
      });

      if (sendNow) {
        await sendCampaign(campaign.id);
      }

      onDone(campaign.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء الحملة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">إنشاء حملة</h1>
          <p className="mt-1 text-sm text-inbox-muted">الخطوة {step} من 3</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md bg-inbox-hover px-3 py-1.5 text-sm"
        >
          إلغاء
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full ${
              step >= n ? "bg-inbox-accent" : "bg-inbox-border"
            }`}
          />
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {step === 1 && (
        <section className="space-y-4 rounded-xl border border-inbox-border bg-inbox-panel p-4">
          <h2 className="font-semibold">1) اختيار قائمة جهات الاتصال</h2>
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
          >
            <option value="">اختر قائمة موجودة...</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.memberCount})
              </option>
            ))}
          </select>

          <div className="rounded-lg border border-dashed border-inbox-border p-3">
            <p className="mb-2 text-sm text-inbox-muted">أو ارفع CSV لقائمة جديدة</p>
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="اسم القائمة"
              className="mb-2 w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
            />
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
              className="mb-2 block w-full text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCreateListWithCsv()}
              className="rounded-md bg-inbox-hover px-3 py-1.5 text-xs disabled:opacity-50"
            >
              إنشاء واستيراد
            </button>
          </div>

          <button
            type="button"
            disabled={!listId}
            onClick={() => setStep(2)}
            className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            التالي
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4 rounded-xl border border-inbox-border bg-inbox-panel p-4">
          <h2 className="font-semibold">2) اختيار قالب معتمد</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-amber-200">
              لا توجد قوالب بحالة approved. اعتمد قالبًا من صفحة القوالب أولًا.
            </p>
          ) : (
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
            >
              <option value="">اختر قالبًا...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.language}
                </option>
              ))}
            </select>
          )}
          {selectedTemplate && (
            <p className="rounded-md bg-inbox-hover p-3 text-sm text-inbox-muted">
              {selectedTemplate.bodyText}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg bg-inbox-hover px-4 py-2 text-sm"
            >
              رجوع
            </button>
            <button
              type="button"
              disabled={!templateId}
              onClick={() => setStep(3)}
              className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              التالي
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4 rounded-xl border border-inbox-border bg-inbox-panel p-4">
          <h2 className="font-semibold">3) معاينة وإرسال</h2>

          <label className="block space-y-1 text-sm">
            <span className="text-inbox-muted">رقم واتساب للإرسال *</span>
            {channels.length === 0 ? (
              <p className="text-sm text-amber-200">
                لا توجد أرقام واتساب نشطة. أضف رقمًا من صفحة «أرقام واتساب».
              </p>
            ) : (
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                required
                className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
              >
                <option value="">اختر رقم واتساب...</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.displayName || ch.phoneNumber} ({ch.phoneNumber})
                  </option>
                ))}
              </select>
            )}
          </label>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اسم الحملة"
            className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
          />
          <div className="rounded-md bg-inbox-hover p-3 text-sm">
            <p>
              القائمة:{" "}
              <span className="font-medium">
                {selectedList?.name} ({selectedList?.memberCount} مستلم محتمل)
              </span>
            </p>
            <p className="mt-1">
              القالب:{" "}
              <span className="font-medium" dir="ltr">
                {selectedTemplate?.name}
              </span>
            </p>
            {selectedChannel && (
              <p className="mt-1">
                رقم واتساب:{" "}
                <span className="font-medium">
                  {selectedChannel.displayName || selectedChannel.phoneNumber}
                </span>
              </p>
            )}
            <p className="mt-2 text-inbox-muted">{selectedTemplate?.bodyText}</p>
            <p className="mt-2 text-xs text-amber-200">
              سيُستبعد تلقائيًا من ألغوا الاشتراك (optedOut). الإرسال يتم على
              دفعات لتجنب حظر الرقم.
            </p>
          </div>

          <label className="block text-sm text-inbox-muted">
            جدولة لاحقًا (اختياري)
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-1 w-full rounded-md bg-inbox-hover px-3 py-2 text-sm text-inbox-text outline-none"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg bg-inbox-hover px-4 py-2 text-sm"
            >
              رجوع
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleLaunch(true)}
              className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "..." : "إرسال الآن"}
            </button>
            <button
              type="button"
              disabled={busy || !scheduledAt || !channelId}
              onClick={() => void handleLaunch(false)}
              className="rounded-lg border border-inbox-border px-4 py-2 text-sm disabled:opacity-50"
            >
              جدولة فقط
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
