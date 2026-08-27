import { Router } from "express";
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  pauseCampaign,
  resumeCampaign,
  retryCampaignFailed,
  sendCampaign,
} from "../controllers/campaigns.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", requireAdmin, listCampaigns);
router.get("/:id", requireAdmin, getCampaign);
router.post("/", requireAdmin, createCampaign);
router.post("/:id/send", requireAdmin, sendCampaign);
router.post("/:id/pause", requireAdmin, pauseCampaign);
router.post("/:id/resume", requireAdmin, resumeCampaign);
router.post("/:id/cancel", requireAdmin, cancelCampaign);
router.post("/:id/retry-failed", requireAdmin, retryCampaignFailed);

export default router;
