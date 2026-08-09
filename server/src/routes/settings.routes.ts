import { Router } from "express";
import {
  getSettings,
  updateClinicSchema,
  updateClinicSettings,
  updateWhatsAppSchema,
  updateWhatsAppSettings,
} from "../controllers/settings.controller";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";

const router = Router();

router.get("/", requireAuth, getSettings);
router.patch(
  "/clinic",
  requireAuth,
  requireAdmin,
  validateBody(updateClinicSchema),
  updateClinicSettings
);
router.patch(
  "/whatsapp",
  requireAuth,
  requireAdmin,
  validateBody(updateWhatsAppSchema),
  updateWhatsAppSettings
);

export default router;
