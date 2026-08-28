import { Router } from "express";
import {
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
} from "../controllers/knowledge.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", requireAdmin, listKnowledge);
router.post("/", requireAdmin, createKnowledge);
router.delete("/:id", requireAdmin, deleteKnowledge);

export default router;
