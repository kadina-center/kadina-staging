import { Router } from "express";
import {
  createAppointment,
  deleteAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
} from "../controllers/appointments.controller";

const router = Router();

router.get("/", listAppointments);
router.post("/", createAppointment);
router.get("/:id", getAppointment);
router.patch("/:id", updateAppointment);
router.delete("/:id", deleteAppointment);

export default router;
