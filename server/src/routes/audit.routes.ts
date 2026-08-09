import { Router } from "express";
import {
  auditStats,
  exportAudit,
  getAuditEntry,
  listAudit,
} from "../controllers/audit.controller";
import { requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/", listAudit);
router.get("/stats", auditStats);
router.get("/export", exportAudit);
router.get("/:id", getAuditEntry);

export default router;
