import { Router } from "express";
import {
  createTag,
  deleteTag,
  listTags,
  updateTag,
} from "../controllers/tags.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", listTags);
router.post("/", requireAdmin, createTag);
router.patch("/:id", requireAdmin, updateTag);
router.delete("/:id", requireAdmin, deleteTag);

export default router;
