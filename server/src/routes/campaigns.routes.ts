import { Router } from "express";
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  pauseCampaign,
  resumeCampaign,
  sendCampaign,
} from "../controllers/campaigns.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

/** List summaries OK for authenticated staff; detail with recipient phones = admin only */
router.get("/", listCampaigns);
router.get("/:id", requireAdmin, getCampaign);
router.post("/", requireAdmin, createCampaign);
router.post("/:id/send", requireAdmin, sendCampaign);
router.post("/:id/pause", requireAdmin, pauseCampaign);
router.post("/:id/resume", requireAdmin, resumeCampaign);
router.post("/:id/cancel", requireAdmin, cancelCampaign);

export default router;
