import { useEffect, useState, type FormEvent } from "react";
import TeamUsersPanel from "../components/TeamUsersPanel";
import {
  getSettings,
  updateClinicSettings,
  updateWhatsAppSettings,
  type ClinicSettings,
  type User,
} from "../lib/api";

type Props = {
  user: User | null;
  onNavigateToChannels?: () => void;
};

export default function Settings({ user, onNavigateToChannels }: Props) {
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clinicSaved, setClinicSaved] = useState(false);
  const [waSaved, setWaSaved] = useState(false);
  const [clinicBusy, setClinicBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);

  const [clinicName, setClinicName] = useState("");
  const [businessHoursJson, setBusinessHoursJson] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [awayMessage, setAwayMessage] = useState("");
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [awayEnabled, setAwayEnabled] = useState(false);

  const [waToken, setWaToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    void getSettings()
      .then((data) => {
        setSettings(data);
        setClinicName(data.clinicName);
        setBusinessHoursJson(data.businessHoursJson);
        setWelcomeMessage(data.welcomeMessage || "");
        setAwayMessage(data.awayMessage || "");
        setWelcomeEnabled(data.welcomeEnabled);
        setAwayEnabled(data.awayEnabled);
        setPhoneNumberId(data.whatsapp.phoneNumberId || "");
        setWabaId(data.whatsapp.businessAccountId || "");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "فشل تحميل الإعدادات");
      });
  }, []);

  async function handleSaveClinic(event: FormEvent) {
    event.preventDefault();
    setClinicBusy(true);
    setError(null);
    setClinicSaved(false);
    try {
      JSON.parse(businessHoursJson);
      const updated = await updateClinicSettings({
        clinicName: clinicName.trim(),
        businessHoursJson,
        welcomeMessage,
        awayMessage,
        welcomeEnabled,
        awayEnabled,
      });
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              clinicName: updated.clinicName ?? clinicName,
              businessHoursJson:
                updated.businessHoursJson ?? businessHoursJson,
              welcomeMessage: updated.welcomeMessage ?? welcomeMessage,
              awayMessage: updated.awayMessage ?? awayMessage,
              welcomeEnabled: updated.welcomeEnabled ?? welcomeEnabled,
              awayEnabled: updated.awayEnabled ?? awayEnabled,
            }
          : prev
      );
      setClinicSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "فشل حفظ إعدادات العيادة"
      );
    } finally {
      setClinicBusy(false);
    }
  }

  async function handleSaveWhatsApp(event: FormEvent) {
    event.preventDefault();
    if (!isAdmin) return;
    setWaBusy(true);
    setError(null);
    setWaSaved(false);
    try {
      await updateWhatsAppSettings({
        ...(waToken.trim()
          ? { whatsappAccessToken: waToken.trim() }
          : {}),
        whatsappPhoneNumberId: phoneNumberId.trim() || null,
        whatsappBusinessAccountId: wabaId.trim() || null,
        ...(verifyToken.trim()
          ? { whatsappVerifyToken: verifyToken.trim() }
          : {}),
      });
      setWaToken("");
      setVerifyToken("");
      const refreshed = await getSettings();
      setSettings(refreshed);
      setPhoneNumberId(refreshed.whatsapp.phoneNumberId || "");
      setWabaId(refreshed.whatsapp.businessAccountId || "");
      setWaSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "فشل حفظ إعدادات واتساب"
      );
    } finally {
      setWaBusy(false);
    }
  }

  if (!settings) {
    return (
      <div className="p-6 text-sm text-inbox-muted" dir="rtl">
        {error || "جاري التحميل..."}
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-6" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">إعدادات العيادة</h1>
        <p className="mt-1 text-sm text-inbox-muted">
          اسم العيادة، ساعات العمل، ورسائل الترحيب والرد الآلي خارج الدوام
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {isAdmin && user && <TeamUsersPanel currentUser={user} />}

      <form
        onSubmit={(e) => void handleSaveClinic(e)}
        className="mb-6 space-y-4 rounded-xl border border-inbox-border bg-inbox-panel p-4"
      >
        <h2 className="font-medium">العيادة</h2>

        <label className="block space-y-1.5 text-sm">
          <span className="text-inbox-muted">اسم العيادة</span>
          <input
            value={clinicName}
            onChange={(e) => setClinicName(e.target.value)}
            className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
            required
          />
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="text-inbox-muted">ساعات العمل (JSON)</span>
          <textarea
            value={businessHoursJson}
            onChange={(e) => setBusinessHoursJson(e.target.value)}
            rows={6}
            className="w-full rounded-lg bg-inbox-hover px-3 py-2 font-mono text-xs outline-none"
            dir="ltr"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">تفعيل رسالة الترحيب</span>
          <input
            type="checkbox"
            checked={welcomeEnabled}
            onChange={(e) => setWelcomeEnabled(e.target.checked)}
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="text-inbox-muted">رسالة الترحيب</span>
          <textarea
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">تفعيل رسالة خارج الدوام</span>
          <input
            type="checkbox"
            checked={awayEnabled}
            onChange={(e) => setAwayEnabled(e.target.checked)}
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="text-inbox-muted">رسالة خارج الدوام</span>
          <textarea
            value={awayMessage}
            onChange={(e) => setAwayMessage(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={clinicBusy || !isAdmin}
            className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {clinicBusy ? "..." : "حفظ إعدادات العيادة"}
          </button>
          {clinicSaved && (
            <span className="text-xs text-inbox-accent">تم الحفظ</span>
          )}
          {!isAdmin && (
            <span className="text-xs text-inbox-muted">
              الحفظ متاح للمسؤول فقط
            </span>
          )}
        </div>
      </form>

      {isAdmin && onNavigateToChannels && (
        <div className="mb-6 rounded-xl border border-inbox-border bg-inbox-panel p-4">
          <h2 className="font-medium">أرقام واتساب</h2>
          <p className="mt-1 text-xs text-inbox-muted">
            إدارة أرقام واتساب متعددة (حتى 5 أرقام) — منفصلة عن إعدادات
            واتساب القديمة أدناه.
          </p>
          <button
            type="button"
            onClick={onNavigateToChannels}
            className="mt-3 rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white"
          >
            إدارة أرقام واتساب
          </button>
        </div>
      )}

      {isAdmin && (
        <form
          onSubmit={(e) => void handleSaveWhatsApp(e)}
          className="space-y-4 rounded-xl border border-inbox-border bg-inbox-panel p-4"
        >
          <h2 className="font-medium">بيانات واتساب (مسؤول)</h2>
          <p className="text-xs text-inbox-muted">
            الرمز الحالي:{" "}
            {settings.whatsapp.accessTokenMasked || "غير مضبوط"}
            {settings.whatsapp.usingEnvFallback
              ? " (من متغيرات البيئة)"
              : ""}
          </p>

          <label className="block space-y-1.5 text-sm">
            <span className="text-inbox-muted">رمز الوصول</span>
            <input
              type="password"
              value={waToken}
              onChange={(e) => setWaToken(e.target.value)}
              placeholder="اتركه فارغًا للإبقاء على الحالي"
              className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              dir="ltr"
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="text-inbox-muted">معرّف رقم الهاتف</span>
            <input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              dir="ltr"
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="text-inbox-muted">معرّف حساب WhatsApp Business</span>
            <input
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              dir="ltr"
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="text-inbox-muted">رمز التحقق</span>
            <input
              type="password"
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              placeholder={
                settings.whatsapp.verifyTokenMasked
                  ? `الحالي: ${settings.whatsapp.verifyTokenMasked}`
                  : "اتركه فارغًا للإبقاء على الحالي"
              }
              className="w-full rounded-lg bg-inbox-hover px-3 py-2 outline-none"
              dir="ltr"
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={waBusy}
              className="rounded-lg bg-inbox-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {waBusy ? "..." : "حفظ إعدادات واتساب"}
            </button>
            {waSaved && (
              <span className="text-xs text-inbox-accent">تم الحفظ</span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
