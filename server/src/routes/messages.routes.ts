import { Router } from "express";
import multer from "multer";
import {
  editMessage,
  pinMessage,
  retryFailedMessage,
  sendInteractive,
  sendMedia,
  sendMessage,
  sendTemplate,
  softDeleteMessage,
  starMessage,
} from "../controllers/messages.controller";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "video/mp4",
  "video/3gpp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error(`نوع الملف غير مسموح: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

router.post("/", sendMessage);
router.post("/media", upload.single("file"), sendMedia);
router.post("/template", sendTemplate);
router.post("/interactive", sendInteractive);
router.post("/:messageId/retry", retryFailedMessage);
router.patch("/:messageId/pin", pinMessage);
router.patch("/:messageId/star", starMessage);
router.patch("/:messageId", editMessage);
router.delete("/:messageId", softDeleteMessage);

export default router;
