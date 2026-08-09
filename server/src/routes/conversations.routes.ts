import { Router } from "express";
import {
  addTagToConversation,
  archiveConversation,
  assignConversation,
  listConversations,
  lockConversation,
  markRead,
  pinConversation,
  removeTagFromConversation,
  takeOver,
  unlockConversation,
  updateConversationStatus,
} from "../controllers/conversations.controller";
import notesRoutes from "./notes.routes";

const router = Router();

router.get("/", listConversations);
router.patch("/:id/status", updateConversationStatus);
router.patch("/:id/assign", assignConversation);
router.patch("/:id/read", markRead);
router.patch("/:id/pin", pinConversation);
router.patch("/:id/archive", archiveConversation);
router.patch("/:id/lock", lockConversation);
router.patch("/:id/unlock", unlockConversation);
router.post("/:id/takeover", takeOver);
router.post("/:id/tags", addTagToConversation);
router.delete("/:id/tags/:tagId", removeTagFromConversation);

// Internal notes — never routed to WhatsApp
router.use("/", notesRoutes);

export default router;
