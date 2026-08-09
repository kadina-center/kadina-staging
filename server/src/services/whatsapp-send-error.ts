import axios from "axios";

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

export type WhatsAppSendErrorCode =
  | "AUTHENTICATION"
  | "PERMISSION"
  | "INVALID_PHONE"
  | "RATE_LIMIT"
  | "CHANNEL_NOT_CONNECTED"
  | "META_API_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN";

/** Typed outbound failure — never includes access tokens. */
export class WhatsAppSendError extends Error {
  readonly code: WhatsAppSendErrorCode;
  readonly metaCode?: number;
  readonly agentMessage: string;
  readonly adminMessage: string;

  constructor(opts: {
    code: WhatsAppSendErrorCode;
    message: string;
    agentMessage: string;
    adminMessage: string;
    metaCode?: number;
  }) {
    super(opts.message);
    this.name = "WhatsAppSendError";
    this.code = opts.code;
    this.metaCode = opts.metaCode;
    this.agentMessage = opts.agentMessage;
    this.adminMessage = opts.adminMessage;
  }
}

export function isWhatsAppSendError(error: unknown): error is WhatsAppSendError {
  return error instanceof WhatsAppSendError;
}

function redactSecrets(raw: string): string {
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/EAA[A-Za-z0-9]+/g, "[REDACTED]");
}

/** Map Meta/network errors to safe Arabic messages + machine code. */
export function toWhatsAppSendError(
  error: unknown,
  fallback = "Failed to send WhatsApp message"
): WhatsAppSendError {
  if (error instanceof WhatsAppSendError) return error;

  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return new WhatsAppSendError({
        code: "NETWORK_ERROR",
        message: redactSecrets(error.message || fallback),
        agentMessage: "تعذر الاتصال بخدمة واتساب. حاول مرة أخرى لاحقًا.",
        adminMessage:
          "تعذر الاتصال بـ Meta Graph API (شبكة/مهلة). تحقق من الاتصال ثم أعد المحاولة.",
      });
    }

    const metaError = error.response.data as MetaErrorBody | undefined;
    const metaCode = metaError?.error?.code;
    const metaType = (metaError?.error?.type || "").toLowerCase();
    const raw = redactSecrets(
      metaError?.error?.message || error.message || fallback
    );

    // NOTE: Meta often sets error.type = "OAuthException" for many Graph
    // failures (including #100 schema/parameter errors). Do NOT treat the
    // type alone as authentication failure.
    const isAuthFailure =
      metaCode === 190 ||
      metaCode === 102 ||
      /invalid oauth access token|session has expired|error validating access token|cannot parse access token|access token has expired|access token is invalid/i.test(
        raw
      );

    if (isAuthFailure) {
      return new WhatsAppSendError({
        code: "AUTHENTICATION",
        message: raw,
        metaCode,
        agentMessage:
          "فشل إرسال واتساب بسبب مشكلة مصادقة القناة. راجع المسؤول.",
        adminMessage:
          "رمز الوصول (Access Token) غير صالح أو منتهٍ. حدّث التوكن من الإعدادات ← أرقام واتساب ثم اختبر الاتصال.",
      });
    }

    if (
      metaCode === 10 ||
      metaCode === 200 ||
      metaCode === 3 ||
      /permission|not authorized|insufficient/i.test(raw)
    ) {
      return new WhatsAppSendError({
        code: "PERMISSION",
        message: raw,
        metaCode,
        agentMessage: "لا توجد صلاحية كافية لإرسال هذه الرسالة عبر واتساب.",
        adminMessage:
          "صلاحيات تطبيق Meta غير كافية لهذه العملية. راجع أذونات WhatsApp في Meta Business.",
      });
    }

    if (
      metaCode === 131030 ||
      /not in allowed list|recipient phone number not in/i.test(raw)
    ) {
      return new WhatsAppSendError({
        code: "PERMISSION",
        message: raw,
        metaCode,
        agentMessage:
          "رقم المستلم غير مسموح في وضع التجربة. راجع المسؤول لإضافته في Meta.",
        adminMessage:
          "المستلم ليس ضمن Allowed List لرقم التجربة في Meta. أضِف الرقم من WhatsApp Manager ← API Setup.",
      });
    }

    if (
      metaCode === 100 ||
      metaCode === 131009 ||
      metaCode === 131026 ||
      /invalid.*phone|phone number|recipient/i.test(raw)
    ) {
      return new WhatsAppSendError({
        code: "INVALID_PHONE",
        message: raw,
        metaCode,
        agentMessage: "رقم المستلم غير صالح أو غير مسجّل على واتساب.",
        adminMessage:
          "رقم المستلم مرفوض من Meta (صيغة غير صحيحة أو غير مسجّل على واتساب).",
      });
    }

    if (
      metaCode === 4 ||
      metaCode === 80007 ||
      metaCode === 130429 ||
      /rate limit|too many|throttl/i.test(raw)
    ) {
      return new WhatsAppSendError({
        code: "RATE_LIMIT",
        message: raw,
        metaCode,
        agentMessage: "تم تجاوز حد الإرسال. حاول مرة أخرى بعد قليل.",
        adminMessage: "Meta Rate Limit — خفّض معدل الإرسال أو أعد المحاولة لاحقًا.",
      });
    }

    if (
      metaCode === 131047 ||
      /outside.*window|24.?hour|re-engagement/i.test(raw)
    ) {
      return new WhatsAppSendError({
        code: "META_API_ERROR",
        message: raw,
        metaCode,
        agentMessage:
          "انتهت نافذة الـ 24 ساعة. استخدم قالبًا معتمدًا للرد على العميل.",
        adminMessage:
          "خارج نافذة محادثة العميل (24 ساعة). أرسل Template معتمدًا لإعادة الفتح.",
      });
    }

    return new WhatsAppSendError({
      code: "META_API_ERROR",
      message: raw,
      metaCode,
      agentMessage: "رفضت واتساب إرسال الرسالة. حاول مرة أخرى أو راجع المسؤول.",
      adminMessage: `خطأ Meta API${metaCode != null ? ` (#${metaCode})` : ""}: ${raw}`,
    });
  }

  if (error instanceof Error) {
    const msg = redactSecrets(error.message || fallback);
    if (/channel|not connected|inactive|credentials|not configured/i.test(msg)) {
      return new WhatsAppSendError({
        code: "CHANNEL_NOT_CONNECTED",
        message: msg,
        agentMessage: "قناة واتساب غير متصلة. راجع المسؤول.",
        adminMessage: msg,
      });
    }
    return new WhatsAppSendError({
      code: "UNKNOWN",
      message: msg,
      agentMessage: "فشل إرسال الرسالة. حاول مرة أخرى.",
      adminMessage: msg,
    });
  }

  return new WhatsAppSendError({
    code: "UNKNOWN",
    message: fallback,
    agentMessage: "فشل إرسال الرسالة. حاول مرة أخرى.",
    adminMessage: fallback,
  });
}

export function publicSendErrorPayload(
  error: unknown,
  isAdmin: boolean
): { code: WhatsAppSendErrorCode; error: string; technicalMessage?: string } {
  const wa = toWhatsAppSendError(error);
  return {
    code: wa.code,
    error: isAdmin ? wa.adminMessage : wa.agentMessage,
    ...(isAdmin ? { technicalMessage: wa.message } : {}),
  };
}
