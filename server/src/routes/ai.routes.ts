import { Router } from "express";
import { copilotSuggestions } from "../controllers/ai.controller";

const router = Router();

// Copilot only — never triggers WhatsApp send
router.post("/copilot-suggestions", copilotSuggestions);

export default router;
