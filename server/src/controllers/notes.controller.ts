import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  AuditAction,
  AuditEntity,
  logAuditFromRequest,
} from "../services/audit.service";
import { assertCanAccessConversation } from "../services/conversation-access.service";
import { emitNoteAdded } from "../services/socket.service";
import {
  TimelineEventType,
  actorFromUser,
  logTimeline,
} from "../services/timeline.service";

/**
 * Internal team notes only.
 * These NEVER go through whatsapp.service / Meta API — team-only visibility.
 */

export async function listNotes(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const notes = await prisma.note.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      include: {
        author: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    res.json(notes);
  } catch (error) {
    console.error("[notes] list error:", error);
    res.status(500).json({ error: "Failed to list notes" });
  }
}

export async function createNote(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const access = await assertCanAccessConversation(req, res, id);
    if (!access) return;

    const { authorId: bodyAuthorId, content } = req.body as {
      authorId?: string;
      content?: string;
    };
    const authorId = req.user?.id || bodyAuthorId;

    if (!authorId || !content?.trim()) {
      res.status(400).json({ error: "content is required (and authenticated user)" });
      return;
    }

    const conversation = {
      id: access.id,
      contactId: access.contactId!,
    };

    const author = await prisma.user.findUnique({ where: { id: authorId } });
    if (!author) {
      res.status(404).json({ error: "Author user not found" });
      return;
    }

    // Internal only — do not call sendTextMessage / WhatsApp API here.
    const note = await prisma.note.create({
      data: {
        conversationId: id,
        authorId,
        content: content.trim(),
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    emitNoteAdded(note);
    logAuditFromRequest(req, {
      action: AuditAction.CREATE,
      entityType: AuditEntity.NOTE,
      entityId: note.id,
      newValues: { content: content.trim().slice(0, 500) },
      metadata: {
        noteId: note.id,
        conversationId: id,
        contactId: conversation.contactId,
      },
    });
    void logTimeline({
      contactId: conversation.contactId,
      conversationId: id,
      eventType: TimelineEventType.NOTE_CREATED,
      title: "إضافة ملاحظة",
      description: content.trim().slice(0, 200),
      actor: actorFromUser(req.user),
      metadata: { noteId: note.id },
    });
    res.status(201).json(note);
  } catch (error) {
    console.error("[notes] create error:", error);
    res.status(500).json({ error: "Failed to create note" });
  }
}

export async function updateNote(req: Request, res: Response): Promise<void> {
  try {
    const { id, noteId } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const { content } = req.body as { content?: string };

    if (!content?.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const existing = await prisma.note.findFirst({
      where: { id: noteId, conversationId: id },
    });
    if (!existing) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { contactId: true },
    });

    const note = await prisma.note.update({
      where: { id: noteId },
      data: { content: content.trim() },
      include: {
        author: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    logAuditFromRequest(req, {
      action: AuditAction.UPDATE,
      entityType: AuditEntity.NOTE,
      entityId: note.id,
      oldValues: { content: existing.content.slice(0, 500) },
      newValues: { content: content.trim().slice(0, 500) },
      metadata: {
        noteId: note.id,
        conversationId: id,
        contactId: conversation?.contactId ?? null,
      },
    });

    if (conversation) {
      void logTimeline({
        contactId: conversation.contactId,
        conversationId: id,
        eventType: TimelineEventType.NOTE_UPDATED,
        title: "تعديل ملاحظة",
        description: content.trim().slice(0, 200),
        actor: actorFromUser(req.user),
        metadata: { noteId: note.id },
      });
    }

    res.json(note);
  } catch (error) {
    console.error("[notes] update error:", error);
    res.status(500).json({ error: "Failed to update note" });
  }
}

export async function deleteNote(req: Request, res: Response): Promise<void> {
  try {
    const { id, noteId } = req.params;
    if (!(await assertCanAccessConversation(req, res, id))) return;

    const existing = await prisma.note.findFirst({
      where: { id: noteId, conversationId: id },
    });
    if (!existing) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { contactId: true },
    });

    await prisma.note.delete({ where: { id: noteId } });

    logAuditFromRequest(req, {
      action: AuditAction.DELETE,
      entityType: AuditEntity.NOTE,
      entityId: existing.id,
      oldValues: { content: existing.content.slice(0, 500) },
      metadata: {
        noteId: existing.id,
        conversationId: id,
        contactId: conversation?.contactId ?? null,
      },
    });

    if (conversation) {
      void logTimeline({
        contactId: conversation.contactId,
        conversationId: id,
        eventType: TimelineEventType.NOTE_DELETED,
        title: "حذف ملاحظة",
        description: existing.content.slice(0, 200),
        actor: actorFromUser(req.user),
        metadata: { noteId: existing.id },
      });
    }

    res.status(204).send();
  } catch (error) {
    console.error("[notes] delete error:", error);
    res.status(500).json({ error: "Failed to delete note" });
  }
}
