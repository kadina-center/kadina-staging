import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import { assertCanAccessContact } from "../services/conversation-access.service";
import {
  getActiveFlowInfo,
  stopFlow,
} from "../services/flow-engine.service";

const TRIGGER_TYPES = new Set(["keyword", "any_message", "no_response_24h"]);
const ACTION_TYPES = new Set([
  "send_text",
  "send_template",
  "assign_to_user",
  "add_tag",
  "set_status",
  "wait",
  "ai_agent_reply",
]);

export async function listFlows(_req: Request, res: Response): Promise<void> {
  try {
    const flows = await prisma.flow.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        steps: { orderBy: { order: "asc" } },
      },
    });
    res.json(flows);
  } catch (error) {
    console.error("[flows] list error:", error);
    res.status(500).json({ error: "Failed to list flows" });
  }
}

export async function getFlow(req: Request, res: Response): Promise<void> {
  try {
    const flow = await prisma.flow.findUnique({
      where: { id: req.params.id },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!flow) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }
    res.json(flow);
  } catch (error) {
    console.error("[flows] get error:", error);
    res.status(500).json({ error: "Failed to get flow" });
  }
}

export async function createFlow(req: Request, res: Response): Promise<void> {
  try {
    const { name, triggerType, triggerValue, isActive } = req.body as {
      name?: string;
      triggerType?: string;
      triggerValue?: string | null;
      isActive?: boolean;
    };

    if (!name?.trim() || !triggerType || !TRIGGER_TYPES.has(triggerType)) {
      res.status(400).json({
        error:
          "name and triggerType (keyword|any_message|no_response_24h) are required",
      });
      return;
    }

    if (triggerType === "keyword" && !triggerValue?.trim()) {
      res.status(400).json({ error: "triggerValue is required for keyword" });
      return;
    }

    const flow = await prisma.flow.create({
      data: {
        name: name.trim(),
        triggerType,
        triggerValue:
          triggerType === "keyword" ? triggerValue!.trim() : null,
        isActive: isActive !== false,
      },
      include: { steps: true },
    });

    logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.FLOW,
      entityId: flow.id,
      newValues: {
        name: flow.name,
        triggerType: flow.triggerType,
        isActive: flow.isActive,
      },
    });

    res.status(201).json(flow);
  } catch (error) {
    console.error("[flows] create error:", error);
    res.status(500).json({ error: "Failed to create flow" });
  }
}

export async function updateFlow(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, triggerType, triggerValue, isActive } = req.body as {
      name?: string;
      triggerType?: string;
      triggerValue?: string | null;
      isActive?: boolean;
    };

    const existing = await prisma.flow.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    if (triggerType && !TRIGGER_TYPES.has(triggerType)) {
      res.status(400).json({ error: "Invalid triggerType" });
      return;
    }

    const nextType = triggerType || existing.triggerType;
    const nextValue =
      triggerValue !== undefined
        ? triggerValue
        : existing.triggerValue;

    if (nextType === "keyword" && !nextValue?.trim()) {
      res.status(400).json({ error: "triggerValue is required for keyword" });
      return;
    }

    const flow = await prisma.flow.update({
      where: { id },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(triggerType ? { triggerType } : {}),
        ...(triggerValue !== undefined
          ? {
              triggerValue:
                nextType === "keyword" ? nextValue?.trim() || null : null,
            }
          : {}),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    const action =
      typeof isActive === "boolean" && isActive !== existing.isActive
        ? isActive
          ? AuditAction.START
          : AuditAction.STOP
        : AuditAction.UPDATE;

    logAuditFromRequest(req, {
      action,
      entityType: AuditEntity.FLOW,
      entityId: flow.id,
      oldValues: {
        name: existing.name,
        triggerType: existing.triggerType,
        isActive: existing.isActive,
      },
      newValues: {
        name: flow.name,
        triggerType: flow.triggerType,
        isActive: flow.isActive,
      },
    });

    res.json(flow);
  } catch (error) {
    console.error("[flows] update error:", error);
    res.status(500).json({ error: "Failed to update flow" });
  }
}

export async function addStep(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { order, actionType, actionValue } = req.body as {
      order?: number;
      actionType?: string;
      actionValue?: string;
    };

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    if (!actionType || !ACTION_TYPES.has(actionType)) {
      res.status(400).json({ error: "Invalid actionType" });
      return;
    }

    if (actionValue === undefined || actionValue === null || actionValue === "") {
      res.status(400).json({ error: "actionValue is required" });
      return;
    }

    let stepOrder = order;
    if (typeof stepOrder !== "number") {
      const last = await prisma.flowStep.findFirst({
        where: { flowId: id },
        orderBy: { order: "desc" },
      });
      stepOrder = (last?.order ?? -1) + 1;
    }

    const step = await prisma.flowStep.create({
      data: {
        flowId: id,
        order: stepOrder,
        actionType,
        actionValue: String(actionValue),
      },
    });

    res.status(201).json(step);
  } catch (error) {
    console.error("[flows] add step error:", error);
    res.status(500).json({ error: "Failed to add step" });
  }
}

export async function deleteStep(req: Request, res: Response): Promise<void> {
  try {
    const { id, stepId } = req.params;
    const step = await prisma.flowStep.findFirst({
      where: { id: stepId, flowId: id },
    });
    if (!step) {
      res.status(404).json({ error: "Step not found" });
      return;
    }

    await prisma.flowStep.delete({ where: { id: stepId } });

    const remaining = await prisma.flowStep.findMany({
      where: { flowId: id },
      orderBy: { order: "asc" },
    });

    await Promise.all(
      remaining.map((s, index) =>
        prisma.flowStep.update({
          where: { id: s.id },
          data: { order: index },
        })
      )
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("[flows] delete step error:", error);
    res.status(500).json({ error: "Failed to delete step" });
  }
}

export async function reorderSteps(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const { stepIds } = req.body as { stepIds?: string[] };

    if (!Array.isArray(stepIds) || stepIds.length === 0) {
      res.status(400).json({ error: "stepIds array is required" });
      return;
    }

    const existing = await prisma.flowStep.findMany({
      where: { flowId: id },
    });
    const existingIds = new Set(existing.map((s) => s.id));

    if (
      stepIds.length !== existing.length ||
      stepIds.some((sid) => !existingIds.has(sid))
    ) {
      res.status(400).json({
        error: "stepIds must include every step of this flow exactly once",
      });
      return;
    }

    await prisma.$transaction(
      stepIds.map((stepId, index) =>
        prisma.flowStep.update({
          where: { id: stepId },
          data: { order: index },
        })
      )
    );

    const steps = await prisma.flowStep.findMany({
      where: { flowId: id },
      orderBy: { order: "asc" },
    });

    res.json(steps);
  } catch (error) {
    console.error("[flows] reorder error:", error);
    res.status(500).json({ error: "Failed to reorder steps" });
  }
}

export async function stopContactFlow(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { contactId } = req.body as { contactId?: string };
    if (!contactId) {
      res.status(400).json({ error: "contactId is required" });
      return;
    }
    if (!(await assertCanAccessContact(req, res, contactId))) return;

    await stopFlow(contactId);
    logAuditFromRequest(req, {
      action: AuditAction.STOP,
      entityType: AuditEntity.FLOW,
      entityId: contactId,
      metadata: { contactId, reason: "manual_stop" },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[flows] stop error:", error);
    res.status(500).json({ error: "Failed to stop flow" });
  }
}

export async function getContactActiveFlow(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const contactId = req.params.contactId;
    if (!(await assertCanAccessContact(req, res, contactId))) return;

    const info = await getActiveFlowInfo(contactId);
    res.json(info);
  } catch (error) {
    console.error("[flows] active info error:", error);
    res.status(500).json({ error: "Failed to get active flow" });
  }
}
