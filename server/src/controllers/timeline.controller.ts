import type { Request, Response } from "express";
import { assertCanAccessContact } from "../services/conversation-access.service";
import { listTimelineEvents } from "../services/timeline.service";
import { parseCursor, parseLimit } from "../utils/pagination";

export async function getContactTimeline(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessContact(req, res, id))) return;

    const { cursor, search, filter, limit } = req.query;
    const take = parseLimit(limit, 30) ?? 30;

    const page = await listTimelineEvents({
      contactId: id,
      cursor: parseCursor(cursor),
      limit: take,
      search: typeof search === "string" ? search : null,
      filter: typeof filter === "string" ? filter : "all",
    });

    res.json(page);
  } catch (error) {
    console.error("[timeline] list error:", error);
    res.status(500).json({ error: "Failed to load timeline" });
  }
}
