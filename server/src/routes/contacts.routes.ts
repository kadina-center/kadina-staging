import { Router } from "express";
import {
  getContactMedia,
  getContactMessages,
  getContactProfile,
  listContacts,
  updateContact,
} from "../controllers/contacts.controller";
import { getContactTimeline } from "../controllers/timeline.controller";

const router = Router();

router.get("/", listContacts);
router.patch("/:id", updateContact);
router.get("/:id/profile", getContactProfile);
router.get("/:id/media", getContactMedia);
router.get("/:id/messages", getContactMessages);
router.get("/:id/timeline", getContactTimeline);

export default router;
