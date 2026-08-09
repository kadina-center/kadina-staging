import { prisma } from "../lib/prisma";
import { env } from "../config/env";

export type BusinessHours = {
  days: number[];
  start: string;
  end: string;
};

export async function getOrCreateClinicSettings() {
  const existing = await prisma.clinicSettings.findFirst();
  if (existing) return existing;
  return prisma.clinicSettings.create({ data: {} });
}

export async function getWhatsAppConfig() {
  const settings = await getOrCreateClinicSettings();
  // Prefer process.env over the boot-time `env` snapshot so .env token
  // rotations take effect without a full server restart (after dotenv reload).
  return {
    accessToken:
      settings.whatsappAccessToken ||
      process.env.WHATSAPP_ACCESS_TOKEN ||
      env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId:
      settings.whatsappPhoneNumberId ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId:
      settings.whatsappBusinessAccountId ||
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
      env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken:
      settings.whatsappVerifyToken ||
      process.env.WHATSAPP_VERIFY_TOKEN ||
      env.WHATSAPP_VERIFY_TOKEN,
  };
}

export function parseBusinessHours(json: string): BusinessHours {
  try {
    const parsed = JSON.parse(json) as BusinessHours;
    if (!Array.isArray(parsed.days) || !parsed.start || !parsed.end) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    return { days: [0, 1, 2, 3, 4], start: "09:00", end: "17:00" };
  }
}

/**
 * Returns true if clinic is currently within business hours in the given IANA timezone.
 * Falls back to Asia/Aden (clinic default) when timezone is invalid.
 */
export function isWithinBusinessHours(
  hours: BusinessHours,
  now = new Date(),
  timezone = "Asia/Aden"
): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Aden",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  }

  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = dayMap[weekday] ?? now.getDay();
  if (!hours.days.includes(day)) return false;
  const [sh, sm] = hours.start.split(":").map(Number);
  const [eh, em] = hours.end.split(":").map(Number);
  const mins = hour * 60 + minute;
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  return mins >= start && mins <= end;
}
