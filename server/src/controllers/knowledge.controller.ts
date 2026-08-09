import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ingestDocument } from "../services/ai.service";

export async function listKnowledge(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const docs = await prisma.knowledgeDocument.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } },
    });
    res.json(
      docs.map((d) => ({
        id: d.id,
        title: d.title,
        content: d.content,
        createdAt: d.createdAt,
        chunkCount: d._count.chunks,
      }))
    );
  } catch (error) {
    console.error("[knowledge] list error:", error);
    res.status(500).json({ error: "Failed to list knowledge documents" });
  }
}

export async function createKnowledge(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { title, content } = req.body as {
      title?: string;
      content?: string;
    };

    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: "title and content are required" });
      return;
    }

    const result = await ingestDocument(title.trim(), content.trim());
    const doc = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: result.documentId },
      include: { _count: { select: { chunks: true } } },
    });

    res.status(201).json({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      createdAt: doc.createdAt,
      chunkCount: doc._count.chunks,
    });
  } catch (error) {
    console.error("[knowledge] create error:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to create document",
    });
  }
}

export async function deleteKnowledge(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.knowledgeDocument.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error("[knowledge] delete error:", error);
    res.status(500).json({ error: "Failed to delete document" });
  }
}
