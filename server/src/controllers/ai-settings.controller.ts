import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getOrCreateAiSettings } from "../services/ai.service";

export async function getAiSettings(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const settings = await getOrCreateAiSettings();
    res.json(settings);
  } catch (error) {
    console.error("[ai-settings] get error:", error);
    res.status(500).json({ error: "Failed to get AI settings" });
  }
}

export async function updateAiSettings(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const {
      isActive,
      systemPrompt,
      confidenceThreshold,
      handoffKeywords,
    } = req.body as {
      isActive?: boolean;
      systemPrompt?: string;
      confidenceThreshold?: number;
      handoffKeywords?: string;
    };

    const current = await getOrCreateAiSettings();

    const nextThreshold =
      typeof confidenceThreshold === "number"
        ? Math.min(1, Math.max(0, confidenceThreshold))
        : current.confidenceThreshold;

    const updated = await prisma.aiAgentSettings.update({
      where: { id: current.id },
      data: {
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        ...(systemPrompt?.trim()
          ? { systemPrompt: systemPrompt.trim() }
          : {}),
        ...(typeof confidenceThreshold === "number"
          ? { confidenceThreshold: nextThreshold }
          : {}),
        ...(typeof handoffKeywords === "string"
          ? { handoffKeywords: handoffKeywords.trim() }
          : {}),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("[ai-settings] update error:", error);
    res.status(500).json({ error: "Failed to update AI settings" });
  }
}
