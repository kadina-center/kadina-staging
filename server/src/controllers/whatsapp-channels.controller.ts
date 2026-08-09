import type { Request, Response } from "express";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import {
  ChannelLimitError,
  ChannelNotFoundError,
  createChannel,
  deleteChannel,
  getChannelById,
  listChannels,
  listChannelsPublicSummary,
  setChannelActive,
  testChannelConnection,
  toPublicChannel,
  updateChannel,
} from "../services/whatsapp-channel.service";

function statusFromError(error: unknown): number {
  if (error instanceof ChannelLimitError) return error.statusCode;
  if (error instanceof ChannelNotFoundError) return error.statusCode;
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number") return code;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already exists") || msg.includes("invalid")) return 400;
    if (msg.includes("required")) return 400;
  }
  return 500;
}

export async function listWhatsAppChannels(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const channels = await listChannels();
    res.json(channels);
  } catch (error) {
    console.error("[whatsapp-channels] list error:", error);
    res.status(500).json({ error: "Failed to list WhatsApp channels" });
  }
}

/** Lightweight list for inbox filters — no secrets, admin + agent */
export async function listWhatsAppChannelsPublic(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const channels = await listChannelsPublicSummary();
    res.json(channels);
  } catch (error) {
    console.error("[whatsapp-channels] public list error:", error);
    res.status(500).json({ error: "Failed to list WhatsApp channels" });
  }
}

export async function getWhatsAppChannel(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const channel = await getChannelById(req.params.id);
    res.json(toPublicChannel(channel));
  } catch (error) {
    const status = statusFromError(error);
    res.status(status).json({
      error: error instanceof Error ? error.message : "Channel not found",
    });
  }
}

export async function createWhatsAppChannel(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const {
      name,
      displayName,
      phoneNumber,
      phoneNumberId,
      accessToken,
      businessAccountId,
      isActive,
      assignedUserId,
    } = req.body as {
      name?: string;
      displayName?: string;
      phoneNumber?: string;
      phoneNumberId?: string;
      accessToken?: string;
      businessAccountId?: string | null;
      isActive?: boolean;
      assignedUserId?: string | null;
    };

    if (!name?.trim() || !phoneNumber?.trim() || !phoneNumberId?.trim() || !accessToken?.trim()) {
      res.status(400).json({
        error: "name, phoneNumber, phoneNumberId, and accessToken are required",
      });
      return;
    }

    const channel = await createChannel({
      name,
      displayName: displayName || name,
      phoneNumber,
      phoneNumberId,
      accessToken,
      businessAccountId,
      isActive,
      assignedUserId,
    });

    void logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.SETTINGS,
      entityId: channel.id,
      status: "SUCCESS",
      newValues: {
        kind: "whatsapp_channel.created",
        id: channel.id,
        name: channel.name,
        phoneNumber: channel.phoneNumber,
        phoneNumberId: channel.phoneNumberId,
        status: channel.status,
        isActive: channel.isActive,
      },
    });

    res.status(201).json(channel);
  } catch (error) {
    const status = statusFromError(error);
    const message =
      error instanceof Error ? error.message : "Failed to create channel";
    void logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.SETTINGS,
      status: "FAILED",
      meta: { kind: "whatsapp_channel.create_failed", error: message },
    });
    res.status(status).json({ error: message });
  }
}

export async function updateWhatsAppChannel(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const channel = await updateChannel(req.params.id, req.body ?? {});
    void logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.SETTINGS,
      entityId: channel.id,
      status: "SUCCESS",
      newValues: {
        kind: "whatsapp_channel.updated",
        id: channel.id,
        name: channel.name,
        phoneNumber: channel.phoneNumber,
        phoneNumberId: channel.phoneNumberId,
        status: channel.status,
        isActive: channel.isActive,
        tokenUpdated: Boolean(
          req.body &&
            typeof req.body === "object" &&
            "accessToken" in req.body &&
            (req.body as { accessToken?: string }).accessToken
        ),
      },
    });
    res.json(channel);
  } catch (error) {
    const status = statusFromError(error);
    res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to update channel",
    });
  }
}

export async function deleteWhatsAppChannel(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const id = req.params.id;
    await deleteChannel(id);
    void logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.SETTINGS,
      entityId: id,
      status: "SUCCESS",
      newValues: { kind: "whatsapp_channel.deleted", id },
    });
    res.status(204).send();
  } catch (error) {
    const status = statusFromError(error);
    res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to delete channel",
    });
  }
}

export async function testWhatsAppChannel(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const result = await testChannelConnection(req.params.id);
    void logAuditFromRequest(req, {
      action: AuditAction.READ,
      entityType: AuditEntity.SETTINGS,
      entityId: req.params.id,
      status: result.status === "CONNECTED" ? "SUCCESS" : "FAILED",
      meta: {
        kind: "whatsapp_channel.test",
        result: result.status,
        message: result.message,
      },
    });
    res.json(result);
  } catch (error) {
    const status = statusFromError(error);
    res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to test channel",
    });
  }
}

export async function activateWhatsAppChannel(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const channel = await setChannelActive(req.params.id, true);
    void logAuditFromRequest(req, {
      action: AuditAction.ENABLE,
      entityType: AuditEntity.SETTINGS,
      entityId: channel.id,
      status: "SUCCESS",
      newValues: { kind: "whatsapp_channel.activated", id: channel.id },
    });
    res.json(channel);
  } catch (error) {
    const status = statusFromError(error);
    res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to activate",
    });
  }
}

export async function deactivateWhatsAppChannel(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const channel = await setChannelActive(req.params.id, false);
    void logAuditFromRequest(req, {
      action: AuditAction.DISABLE,
      entityType: AuditEntity.SETTINGS,
      entityId: channel.id,
      status: "SUCCESS",
      newValues: { kind: "whatsapp_channel.deactivated", id: channel.id },
    });
    res.json(channel);
  } catch (error) {
    const status = statusFromError(error);
    res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to deactivate",
    });
  }
}
