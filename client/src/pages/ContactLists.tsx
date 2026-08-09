import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createContactList,
  getContactList,
  getContactLists,
  importContactListCsv,
  type ContactListDetail,
  type ContactListSummary,
} from "../lib/api";

type Props = {
  onOpenBuilder?: () => void;
};

export default function ContactLists({ onOpenBuilder }: Props) {
  const [lists, setLists] = useState<ContactListSummary[]>([]);
  const [selected, setSelected] = useState<ContactListDetail | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getContactLists();
      setLists(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل التحميل");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createContactList(name.trim());
      setLists((prev) => [created, ...prev]);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل الإنشاء");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(id: string) {
    setBusy(true);
    setError(null);
    try {
      const detail = await getContactList(id);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل فتح القائمة");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File | null) {
    if (!file || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importContactListCsv(selected.id, file);
      const detail = await getContactList(selected.id);
      setSelected(detail);
      setLists((prev) =>
        prev.map((l) =>
          l.id === selected.id
            ? { ...l, memberCount: result.memberCount }
            : l
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل استيراد CSV");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">قوائم جهات الاتصال</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            قسّم العملاء لشرائح قبل إطلاق الحملات
          </p>
        </div>
        {onOpenBuilder && (
          <button
            type="button"
            onClick={onOpenBuilder}
            className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white"
          >
            إنشاء حملة
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="mb-6 flex flex-wrap gap-2 rounded-xl border border-inbox-border bg-inbox-panel p-4"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم القائمة الجديدة"
          className="min-w-[220px] flex-1 rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          إنشاء قائمة
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-inbox-muted">جاري التحميل...</p>}

      <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <ul className="space-y-2">
          {lists.map((list) => (
            <li key={list.id}>
              <button
                type="button"
                onClick={() => void handleSelect(list.id)}
                className={`w-full rounded-lg border px-3 py-3 text-right ${
                  selected?.id === list.id
                    ? "border-inbox-accent bg-inbox-hover"
                    : "border-inbox-border bg-inbox-panel hover:bg-inbox-hover"
                }`}
              >
                <div className="font-medium">{list.name}</div>
                <div className="text-xs text-inbox-muted">
                  {list.memberCount} عضو
                </div>
              </button>
            </li>
          ))}
          {!loading && lists.length === 0 && (
            <li className="text-sm text-inbox-muted">لا توجد قوائم بعد</li>
          )}
        </ul>

        <section className="rounded-xl border border-inbox-border bg-inbox-panel p-4">
          {!selected ? (
            <p className="text-sm text-inbox-muted">اختر قائمة لعرض الأعضاء</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="text-xs text-inbox-muted">
                    {selected.memberCount} عضو
                  </p>
                </div>
                <label className="cursor-pointer rounded-md bg-inbox-hover px-3 py-2 text-xs hover:bg-inbox-border">
                  رفع CSV (phone, name)
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) =>
                      void handleImport(e.target.files?.[0] ?? null)
                    }
                  />
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-inbox-muted">
                    <tr>
                      <th className="px-2 py-2 text-right">الاسم</th>
                      <th className="px-2 py-2 text-right">الهاتف</th>
                      <th className="px-2 py-2 text-right">الاشتراك</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.contacts.map((c) => (
                      <tr key={c.id} className="border-t border-inbox-border">
                        <td className="px-2 py-2">{c.name || "—"}</td>
                        <td className="px-2 py-2" dir="ltr">
                          {c.phone}
                        </td>
                        <td className="px-2 py-2">
                          {c.optedOut ? (
                            <span className="text-red-300">ملغى</span>
                          ) : (
                            <span className="text-emerald-300">نشط</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {selected.contacts.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-2 py-6 text-center text-inbox-muted"
                        >
                          القائمة فارغة — ارفع CSV
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
