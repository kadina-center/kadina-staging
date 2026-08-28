import { Router } from "express";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  testSubscription,
} from "../controllers/webhook-subscriptions.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", requireAdmin, listSubscriptions);
router.post("/", requireAdmin, createSubscription);
router.delete("/:id", requireAdmin, deleteSubscription);
router.post("/:id/test", requireAdmin, testSubscription);

export default router;
