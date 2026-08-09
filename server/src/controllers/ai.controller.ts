import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { generateCopilotSuggestions } from "../services/ai.service";
import {
  assertCanAccessContact,
  assertCanAccessConversation,
} from "../services/conversation-access.service";

function anthropicConfigured(): boolean {
  const key = env.ANTHROPIC_API_KEY;
  return Boolean(key && key !== "REPLACE_ME");
}

/**
 * Copilot endpoint — suggestions only. Never sends WhatsApp messages.
 * Authorization runs before any message load or AI call.
 */
export async function copilotSuggestions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { conversationId, contactId } = req.body as {
      conversationId?: string;
      contactId?: string;
    };

    let resolvedContactId: string | undefined;

    // Authorization before any AI/config short-circuit (keeps IDOR → 404).
    if (conversationId) {
      const access = await assertCanAccessConversation(
        req,
        res,
        conversationId
      );
      if (!access) return;
      resolvedContactId = access.contactId;
    } else if (contactId) {
      if (!(await assertCanAccessContact(req, res, contactId))) return;
      resolvedContactId = contactId;
    } else {
      res.status(400).json({ error: "conversationId or contactId is required" });
      return;
    }

    if (!resolvedContactId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // After authz: skip history/AI work when key is missing.
    if (!anthropicConfigured()) {
      res.status(503).json({
        error: "Copilot غير مفعّل حاليًا (مفتاح AI غير مضبوط)",
      });
      return;
    }

    const history = await prisma.message.findMany({
      where: { contactId: resolvedContactId },
      orderBy: { createdAt: "asc" },
      take: 30,
    });

    const suggestions = await generateCopilotSuggestions(history);
    res.json({ suggestions });
  } catch (error) {
    console.error("[ai] copilot error:", error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate copilot suggestions",
    });
  }
}
