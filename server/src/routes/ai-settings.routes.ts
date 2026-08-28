import { Router } from "express";
import {
  getAiSettings,
  updateAiSettings,
} from "../controllers/ai-settings.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", requireAdmin, getAiSettings);
router.patch("/", requireAdmin, updateAiSettings);

export default router;
