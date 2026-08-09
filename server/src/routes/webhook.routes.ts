import { Router } from "express";
import {
  handleWebhook,
  verifyWebhook,
} from "../controllers/webhook.controller";
import { verifyMetaSignature } from "../middleware/verify-meta-signature";

const router = Router();

router.get("/", verifyWebhook);
router.post("/", verifyMetaSignature, handleWebhook);

export default router;
