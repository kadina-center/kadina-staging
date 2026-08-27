import { Router } from "express";
import {
  createTemplateHandler,
  listTemplates,
  syncTemplateStatus,
} from "../controllers/templates.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", listTemplates);
router.post("/", requireAdmin, createTemplateHandler);
router.post("/:id/sync-status", requireAdmin, syncTemplateStatus);

export default router;
