import { Router } from "express";
import {
  changeUserPassword,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "../controllers/users.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", requireAdmin, listUsers);
router.post("/", requireAdmin, createUser);
router.patch("/:id", requireAdmin, updateUser);
router.post("/:id/password", requireAdmin, changeUserPassword);
router.delete("/:id", requireAdmin, deleteUser);

export default router;
