import axios from "axios";
import crypto from "crypto";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { generateWebhookSecret } from "../services/webhook-dispatcher.service";

const ALLOWED_EVENTS = new Set([
  "message.received",
  "conversation.assigned",
  "campaign.completed",
]);

function normalizeEvents(events: unknown): string | null {
  if (typeof events === "string") {
    const list = events
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (!list.length || list.some((e) => !ALLOWED_EVENTS.has(e))) return null;
    return [...new Set(list)].join(",");
  }
  if (Array.isArray(events)) {
    const list = events.map(String).map((e) => e.trim()).filter(Boolean);
    if (!list.length || list.some((e) => !ALLOWED_EVENTS.has(e))) return null;
    return [...new Set(list)].join(",");
  }
  return null;
}

export async function listSubscriptions(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const rows = await prisma.webhookSubscription.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        // never return secret after creation
      },
    });
    res.json(rows);
  } catch (error) {
    console.error("[webhook-subscriptions] list error:", error);
    res.status(500).json({ error: "Failed to list webhook subscriptions" });
  }
}

export async function createSubscription(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { url, events } = req.body as { url?: string; events?: unknown };
    if (!url?.trim() || !/^https?:\/\//i.test(url.trim())) {
      res.status(400).json({ error: "A valid http(s) url is required" });
      return;
    }

    const normalizedEvents = normalizeEvents(events);
    if (!normalizedEvents) {
      res.status(400).json({
        error:
          "events must include one or more of: message.received, conversation.assigned, campaign.completed",
      });
      return;
    }

    const secret = generateWebhookSecret();
    const created = await prisma.webhookSubscription.create({
      data: {
        url: url.trim(),
        events: normalizedEvents,
        secret,
        isActive: true,
      },
    });

    // Secret is returned only once at creation time
    res.status(201).json({
      id: created.id,
      url: created.url,
      events: created.events,
      isActive: created.isActive,
      createdAt: created.createdAt,
      secret,
    });
  } catch (error) {
    console.error("[webhook-subscriptions] create error:", error);
    res.status(500).json({ error: "Failed to create webhook subscription" });
  }
}

export async function deleteSubscription(
  req: Request,
  res: Response
): Promise<void> {
  try {
    await prisma.webhookSubscription.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error("[webhook-subscriptions] delete error:", error);
    res.status(500).json({ error: "Failed to delete webhook subscription" });
  }
}

export async function testSubscription(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const sub = await prisma.webhookSubscription.findUnique({
      where: { id: req.params.id },
    });
    if (!sub) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }

    const body = JSON.stringify({
      event: "test.ping",
      timestamp: new Date().toISOString(),
      data: { message: "WATI inbox webhook test" },
    });
    const signature = crypto
      .createHmac("sha256", sub.secret)
      .update(body)
      .digest("hex");

    const response = await axios.post(sub.url, body, {
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Webhook-Test": "1",
      },
      timeout: 10000,
      transformRequest: [(data) => data],
      validateStatus: () => true,
    });

    res.json({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
    });
  } catch (error) {
    console.error("[webhook-subscriptions] test error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Test webhook failed",
    });
  }
}
