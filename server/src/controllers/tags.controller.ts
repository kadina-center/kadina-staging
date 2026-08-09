import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";

export async function listTags(_req: Request, res: Response): Promise<void> {
  try {
    const tags = await prisma.tag.findMany({
      orderBy: { name: "asc" },
    });
    res.json(tags);
  } catch (error) {
    console.error("[tags] list error:", error);
    res.status(500).json({ error: "Failed to list tags" });
  }
}

export async function createTag(req: Request, res: Response): Promise<void> {
  try {
    const { name, color } = req.body as { name?: string; color?: string };

    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const tag = await prisma.tag.create({
      data: {
        name: name.trim(),
        color: color?.trim() || "#3B82F6",
      },
    });

    logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.TAG,
      entityId: tag.id,
      newValues: { name: tag.name, color: tag.color },
    });

    res.status(201).json(tag);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create tag";
    console.error("[tags] create error:", message);
    res.status(500).json({ error: message });
  }
}

export async function updateTag(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, color } = req.body as { name?: string; color?: string };

    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }

    const data: { name?: string; color?: string } = {};
    if (typeof name === "string" && name.trim()) {
      data.name = name.trim();
    }
    if (typeof color === "string" && color.trim()) {
      data.color = color.trim();
    }

    if (!data.name && !data.color) {
      res.status(400).json({ error: "name or color is required" });
      return;
    }

    const tag = await prisma.tag.update({
      where: { id },
      data,
    });

    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.TAG,
      entityId: tag.id,
      oldValues: { name: existing.name, color: existing.color },
      newValues: { name: tag.name, color: tag.color },
    });

    res.json(tag);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update tag";
    console.error("[tags] update error:", message);
    res.status(500).json({ error: message });
  }
}

export async function deleteTag(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const existing = await prisma.tag.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    await prisma.tag.delete({ where: { id } });

    logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.TAG,
      entityId: id,
      oldValues: { name: existing.name, color: existing.color },
    });

    res.status(204).send();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete tag";
    console.error("[tags] delete error:", message);
    res.status(500).json({ error: message });
  }
}
