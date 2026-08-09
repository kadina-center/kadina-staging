import { Router } from "express";
import multer from "multer";
import {
  addMembers,
  createContactList,
  getContactList,
  importCsv,
  listContactLists,
} from "../controllers/contact-lists.controller";
import { requireAdmin } from "../middleware/auth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.get("/", listContactLists);
router.post("/", requireAdmin, createContactList);
/** Member phones / import = admin only (PII) */
router.get("/:id", requireAdmin, getContactList);
router.post("/:id/members", requireAdmin, addMembers);
router.post("/:id/import", requireAdmin, upload.single("file"), importCsv);

export default router;
