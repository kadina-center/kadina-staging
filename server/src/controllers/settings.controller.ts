import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  getOrCreateClinicSettings,
  getWhatsAppConfig,
} from "../services/clinic-settings.service";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";

export const updateClinicSchema = z.object({
  clinicName: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  businessHoursJson: z.string().min(2).optional(),
  welcomeMessage: z.string().optional(),
  awayMessage: z.string().optional(),
  welcomeEnabled: z.boolean().optional(),
  awayEnabled: z.boolean().optional(),
});

export const updateWhatsAppSchema = z.object({
  whatsappAccessToken: z.string().min(10).optional().nullable(),
  whatsappPhoneNumberId: z.string().min(3).optional().nullable(),
  whatsappBusinessAccountId: z.string().min(3).optional().nullable(),
  whatsappVerifyToken: z.string().min(3).optional().nullable(),
});

function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length < 12) return "***";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await getOrCreateClinicSettings();
    const wa = await getWhatsAppConfig();
    res.json({
      clinicName: settings.clinicName,
      timezone: settings.timezone,
      language: settings.language,
      businessHoursJson: settings.businessHoursJson,
      welcomeMessage: settings.welcomeMessage,
      awayMessage: settings.awayMessage,
      welcomeEnabled: settings.welcomeEnabled,
      awayEnabled: settings.awayEnabled,
      whatsapp: {
        accessTokenMasked: maskSecret(wa.accessToken),
        phoneNumberId: wa.phoneNumberId,
        businessAccountId: wa.businessAccountId,
        verifyTokenMasked: maskSecret(wa.verifyToken),
        usingEnvFallback: !settings.whatsappAccessToken,
      },
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error("[settings] get error:", error);
    res.status(500).json({ error: "Failed to load settings" });
  }
}

export async function updateClinicSettings(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const settings = await getOrCreateClinicSettings();
    const keys = Object.keys(req.body || {});
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    const settingsRecord = settings as unknown as Record<string, unknown>;
    const bodyRecord = (req.body || {}) as Record<string, unknown>;
    for (const key of keys) {
      oldValues[key] = settingsRecord[key];
      newValues[key] = bodyRecord[key];
    }
    const updated = await prisma.clinicSettings.update({
      where: { id: settings.id },
      data: req.body,
    });
    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.SETTINGS,
      entityId: updated.id,
      oldValues,
      newValues,
      metadata: { keys, scope: "clinic" },
    });
    res.json(updated);
  } catch (error) {
    console.error("[settings] clinic update error:", error);
    res.status(500).json({ error: "Failed to update clinic settings" });
  }
}

export async function updateWhatsAppSettings(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const settings = await getOrCreateClinicSettings();
    const body = req.body as z.infer<typeof updateWhatsAppSchema>;
    const updated = await prisma.clinicSettings.update({
      where: { id: settings.id },
      data: {
        ...(body.whatsappAccessToken !== undefined
          ? { whatsappAccessToken: body.whatsappAccessToken }
          : {}),
        ...(body.whatsappPhoneNumberId !== undefined
          ? { whatsappPhoneNumberId: body.whatsappPhoneNumberId }
          : {}),
        ...(body.whatsappBusinessAccountId !== undefined
          ? { whatsappBusinessAccountId: body.whatsappBusinessAccountId }
          : {}),
        ...(body.whatsappVerifyToken !== undefined
          ? { whatsappVerifyToken: body.whatsappVerifyToken }
          : {}),
      },
    });

    // Multi-WA: outbound uses WhatsAppChannel credentials — keep default channel in sync.
    if (
      body.whatsappAccessToken !== undefined ||
      body.whatsappPhoneNumberId !== undefined ||
      body.whatsappBusinessAccountId !== undefined
    ) {
      try {
        const { ensureDefaultWhatsAppChannel } = await import(
          "../services/whatsapp-channel.service"
        );
        const { DEFAULT_WHATSAPP_CHANNEL_ID } = await import(
          "../constants/whatsapp-channels"
        );
        await ensureDefaultWhatsAppChannel();
        await prisma.whatsAppChannel.update({
          where: { id: DEFAULT_WHATSAPP_CHANNEL_ID },
          data: {
            ...(body.whatsappAccessToken
              ? { accessToken: body.whatsappAccessToken }
              : {}),
            ...(body.whatsappPhoneNumberId
              ? { phoneNumberId: body.whatsappPhoneNumberId }
              : {}),
            ...(body.whatsappBusinessAccountId !== undefined
              ? { businessAccountId: body.whatsappBusinessAccountId }
              : {}),
          },
        });
        const { testChannelConnection } = await import(
          "../services/whatsapp-channel.service"
        );
        await testChannelConnection(DEFAULT_WHATSAPP_CHANNEL_ID);
      } catch (syncError) {
        console.error(
          "[settings] failed to sync WhatsAppChannel from ClinicSettings:",
          syncError
        );
      }
    }

    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.SETTINGS,
      entityId: updated.id,
      oldValues: {
        whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
        whatsappBusinessAccountId: settings.whatsappBusinessAccountId,
        tokenChanged: body.whatsappAccessToken !== undefined,
      },
      newValues: {
        whatsappPhoneNumberId: updated.whatsappPhoneNumberId,
        whatsappBusinessAccountId: updated.whatsappBusinessAccountId,
        tokenChanged: body.whatsappAccessToken !== undefined,
      },
      metadata: { scope: "whatsapp" },
    });
    res.json({
      ok: true,
      whatsappAccessToken: maskSecret(updated.whatsappAccessToken),
      whatsappPhoneNumberId: updated.whatsappPhoneNumberId,
      whatsappBusinessAccountId: updated.whatsappBusinessAccountId,
      whatsappVerifyToken: maskSecret(updated.whatsappVerifyToken),
    });
  } catch (error) {
    console.error("[settings] whatsapp update error:", error);
    res.status(500).json({ error: "Failed to update WhatsApp settings" });
  }
}
