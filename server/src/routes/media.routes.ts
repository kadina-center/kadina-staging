import { Router } from "express";
import { serveSignedMedia } from "../controllers/media.controller";

const router = Router();

router.get("/:filename", (req, res) => {
  void serveSignedMedia(req, res);
});

export default router;
