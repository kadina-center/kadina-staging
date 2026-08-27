import { Router } from "express";
import {
  exportAnalytics,
  getCampaignAnalytics,
  getOverview,
} from "../controllers/analytics.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/overview", requireAdmin, getOverview);
/** Campaign performance is admin ops data */
router.get("/campaigns/:id", requireAdmin, getCampaignAnalytics);
/** CSV includes phone numbers — admin only */
router.get("/export", requireAdmin, exportAnalytics);

export default router;
