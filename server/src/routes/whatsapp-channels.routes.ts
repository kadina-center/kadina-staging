import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth";
import {
  activateWhatsAppChannel,
  createWhatsAppChannel,
  deactivateWhatsAppChannel,
  deleteWhatsAppChannel,
  getWhatsAppChannel,
  listWhatsAppChannels,
  listWhatsAppChannelsPublic,
  testWhatsAppChannel,
  updateWhatsAppChannel,
} from "../controllers/whatsapp-channels.controller";

const router = Router();

router.use(requireAuth);

/** Inbox filter — agents may list summaries (no tokens) */
router.get("/public", listWhatsAppChannelsPublic);

/** Admin-only management */
router.get("/", requireAdmin, listWhatsAppChannels);
router.get("/:id", requireAdmin, getWhatsAppChannel);
router.post("/", requireAdmin, createWhatsAppChannel);
router.patch("/:id", requireAdmin, updateWhatsAppChannel);
router.delete("/:id", requireAdmin, deleteWhatsAppChannel);
router.post("/:id/test", requireAdmin, testWhatsAppChannel);
router.post("/:id/activate", requireAdmin, activateWhatsAppChannel);
router.post("/:id/deactivate", requireAdmin, deactivateWhatsAppChannel);

export default router;
