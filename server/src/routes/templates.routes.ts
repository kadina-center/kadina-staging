import { Router } from "express";
import {
  createTemplateHandler,
  listTemplates,
  syncTemplateStatus,
} from "../controllers/templates.controller";

const router = Router();

router.get("/", listTemplates);
router.post("/", createTemplateHandler);
router.post("/:id/sync-status", syncTemplateStatus);

export default router;
