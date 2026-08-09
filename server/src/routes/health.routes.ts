import { Router } from "express";
import { getDetailedHealth, getHealth } from "../controllers/health.controller";
import { requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", getHealth);
router.get("/detailed", requireAuth, requireAdmin, getDetailedHealth);

export default router;
