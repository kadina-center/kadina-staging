/** User-facing Arabic labels — UI polish only, no business logic. */

export const CONVERSATION_STATUS_LABELS: Record<string, string> = {
  open: "مفتوحة",
  pending: "معلقة",
  closed: "مغلقة",
};

export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  pending: "قيد الإرسال",
  sent: "تم الإرسال",
  delivered: "تم التسليم",
  read: "تمت القراءة",
  failed: "فشل",
};

export const CHANNEL_STATUS_LABELS: Record<string, string> = {
  CONNECTED: "متصل",
  DISCONNECTED: "غير متصل",
  ERROR: "خطأ",
  PENDING: "قيد الانتظار",
  UNKNOWN: "غير معروف",
};

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "مجدول",
  completed: "مكتمل",
  cancelled: "ملغى",
  no_show: "لم يحضر",
};

export const MEDIA_TYPE_LABELS: Record<string, string> = {
  image: "صورة",
  document: "مستند",
  audio: "صوت",
  video: "فيديو",
  sticker: "ملصق",
};

export const SENDER_TYPE_LABELS: Record<string, string> = {
  ADMIN: "مدير",
  AGENT: "موظف",
  AI: "ذكاء اصطناعي",
  BOT: "بوت",
  SYSTEM: "نظام",
  AUTOMATION: "أتمتة",
  CUSTOMER: "عميل",
};

export const ROLE_LABELS: Record<string, string> = {
  admin: "مدير",
  agent: "موظف",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: "تسجيل دخول",
  LOGOUT: "تسجيل خروج",
  CREATE: "إنشاء",
  UPDATE: "تحديث",
  DELETE: "حذف",
  SEND: "إرسال",
  RETRY: "إعادة محاولة",
  READ: "قراءة",
  EXPORT: "تصدير",
  UPLOAD: "رفع",
  DOWNLOAD: "تنزيل",
  LOCK: "قفل",
  UNLOCK: "فتح القفل",
  TAKEOVER: "استلام",
  TRANSFER: "نقل",
  ASSIGN: "تعيين",
  START: "بدء",
  STOP: "إيقاف",
  PIN: "تثبيت",
  UNPIN: "إلغاء التثبيت",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  USER: "مستخدم",
  CONTACT: "جهة اتصال",
  MESSAGE: "رسالة",
  CONVERSATION: "محادثة",
  NOTE: "ملاحظة",
  TAG: "وسم",
  CAMPAIGN: "حملة",
  FLOW: "تدفق",
  TEMPLATE: "قالب",
  SETTINGS: "إعدادات",
  MEDIA: "وسائط",
  APPOINTMENT: "موعد",
  CRM: "CRM",
  CHANNEL: "قناة",
  AUDIT: "تدقيق",
  SYSTEM: "نظام",
  LOGIN: "تسجيل دخول",
  LOGOUT: "تسجيل خروج",
};

export const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  UTILITY: "خدمي",
  MARKETING: "تسويقي",
  AUTHENTICATION: "مصادقة",
};

export const AUDIT_STATUS_LABELS: Record<string, string> = {
  SUCCESS: "نجاح",
  FAILED: "فشل",
  WARNING: "تحذير",
};

export function labelOr(
  map: Record<string, string>,
  value?: string | null,
  fallback = "—"
): string {
  if (!value) return fallback;
  return map[value] || map[value.toUpperCase()] || map[value.toLowerCase()] || value;
}
