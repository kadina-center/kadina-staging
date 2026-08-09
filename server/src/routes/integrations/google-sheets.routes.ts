import { Router } from "express";
import { exportContacts } from "../../controllers/google-sheets.controller";
import { requireAdmin } from "../../middleware/auth";

const router = Router();

router.post("/export", requireAdmin, exportContacts);

export default router;
