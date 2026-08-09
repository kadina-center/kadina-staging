import { Router } from "express";
import {
  addStep,
  createFlow,
  deleteStep,
  getContactActiveFlow,
  getFlow,
  listFlows,
  reorderSteps,
  stopContactFlow,
  updateFlow,
} from "../controllers/flows.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", listFlows);
router.post("/", requireAdmin, createFlow);

router.post("/stop", stopContactFlow);
router.get("/active/:contactId", getContactActiveFlow);

router.get("/:id", getFlow);
router.patch("/:id", requireAdmin, updateFlow);
router.post("/:id/steps", requireAdmin, addStep);
router.delete("/:id/steps/:stepId", requireAdmin, deleteStep);
router.patch("/:id/steps/reorder", requireAdmin, reorderSteps);

export default router;
