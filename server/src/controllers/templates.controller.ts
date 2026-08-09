import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  createTemplate,
  getTemplateStatusFromMeta,
} from "../services/whatsapp.service";

const ALLOWED_CATEGORIES = new Set([
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION",
]);

function normalizeStatus(status: string): string {
  const value = status.toLowerCase();
  if (value === "approved") return "approved";
  if (value === "rejected" || value === "disabled") return "rejected";
  return "pending";
}

export async function listTemplates(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const templates = await prisma.template.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(templates);
  } catch (error) {
    console.error("[templates] list error:", error);
    res.status(500).json({ error: "Failed to list templates" });
  }
}

export async function createTemplateHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { name, category, language, bodyText } = req.body as {
      name?: string;
      category?: string;
      language?: string;
      bodyText?: string;
    };

    if (!name?.trim() || !bodyText?.trim() || !category) {
      res
        .status(400)
        .json({ error: "name, category, and bodyText are required" });
      return;
    }

    const normalizedCategory = category.toUpperCase();
    if (!ALLOWED_CATEGORIES.has(normalizedCategory)) {
      res.status(400).json({
        error: "category must be MARKETING, UTILITY, or AUTHENTICATION",
      });
      return;
    }

    // Meta template names: lowercase letters, numbers, underscores
    const templateName = name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

    if (!templateName) {
      res.status(400).json({ error: "Invalid template name" });
      return;
    }

    const lang = (language || "ar").trim();

    let metaTemplateId: string | null = null;
    let status = "pending";

    try {
      const meta = await createTemplate(
        templateName,
        normalizedCategory,
        lang,
        bodyText.trim()
      );
      metaTemplateId = meta.metaTemplateId;
      status = normalizeStatus(meta.status);
    } catch (error) {
      // Still store locally so the UI can show the attempt; surface Meta error
      const message =
        error instanceof Error ? error.message : "Meta template create failed";
      const template = await prisma.template.create({
        data: {
          name: templateName,
          category: normalizedCategory,
          language: lang,
          bodyText: bodyText.trim(),
          status: "pending",
          metaTemplateId: null,
        },
      });
      res.status(201).json({
        ...template,
        warning: message,
      });
      return;
    }

    const template = await prisma.template.create({
      data: {
        name: templateName,
        category: normalizedCategory,
        language: lang,
        bodyText: bodyText.trim(),
        status,
        metaTemplateId,
      },
    });

    res.status(201).json(template);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create template";
    console.error("[templates] create error:", message);
    res.status(500).json({ error: message });
  }
}

export async function syncTemplateStatus(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const meta = await getTemplateStatusFromMeta(template.name);
    const updated = await prisma.template.update({
      where: { id },
      data: {
        status: normalizeStatus(meta.status),
        ...(meta.metaTemplateId
          ? { metaTemplateId: meta.metaTemplateId }
          : {}),
      },
    });

    res.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync template status";
    console.error("[templates] sync error:", message);
    res.status(500).json({ error: message });
  }
}
