import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, loginSchema, logout, me } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";

const router = Router();

/** Login brute-force guard — do not reuse for unrelated endpoints. */
export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 10,
} as const;

const loginLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT.windowMs,
  max: LOGIN_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts" },
});

router.post("/login", loginLimiter, validateBody(loginSchema), login);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);

export default router;
