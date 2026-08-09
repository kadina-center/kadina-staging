import { Router } from "express";
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from "../controllers/notes.controller";

/**
 * Internal team notes only.
 * Mounted at /conversations so paths are:
 *   GET    /conversations/:id/notes
 *   POST   /conversations/:id/notes
 *   PATCH  /conversations/:id/notes/:noteId
 *   DELETE /conversations/:id/notes/:noteId
 *
 * These endpoints never call whatsapp.service — notes stay team-internal.
 */
const router = Router({ mergeParams: true });

router.get("/:id/notes", listNotes);
router.post("/:id/notes", createNote);
router.patch("/:id/notes/:noteId", updateNote);
router.delete("/:id/notes/:noteId", deleteNote);

export default router;
