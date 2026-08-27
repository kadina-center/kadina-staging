import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "fs";
import helmet from "helmet";
import http from "http";
import { bootstrapApp } from "./bootstrap";
import { env } from "./config/env";
import { requireAuth } from "./middleware/auth";
import aiSettingsRoutes from "./routes/ai-settings.routes";
import analyticsRoutes from "./routes/analytics.routes";
import appointmentsRoutes from "./routes/appointments.routes";
import auditRoutes from "./routes/audit.routes";
import authRoutes from "./routes/auth.routes";
import { ensureRequestId } from "./services/audit.service";
import campaignsRoutes from "./routes/campaigns.routes";
import contactListsRoutes from "./routes/contact-lists.routes";
import contactsRoutes from "./routes/contacts.routes";
import conversationsRoutes from "./routes/conversations.routes";
import flowsRoutes from "./routes/flows.routes";
import healthRoutes from "./routes/health.routes";
import googleSheetsRoutes from "./routes/integrations/google-sheets.routes";
import knowledgeRoutes from "./routes/knowledge.routes";
import mediaRoutes from "./routes/media.routes";
import messagesRoutes from "./routes/messages.routes";
import settingsRoutes from "./routes/settings.routes";
import tagsRoutes from "./routes/tags.routes";
import templatesRoutes from "./routes/templates.routes";
import usersRoutes from "./routes/users.routes";
import webhookRoutes from "./routes/webhook.routes";
import webhookSubscriptionsRoutes from "./routes/webhook-subscriptions.routes";
import whatsappChannelsRoutes from "./routes/whatsapp-channels.routes";
import { createGracefulShutdownHandler } from "./lib/graceful-shutdown";
import { prisma } from "./lib/prisma";
import { logSystemError } from "./services/error-log.service";
import { registerFlowJobHandlers } from "./services/flow-engine.service";
import {
  startScheduledJobRunner,
  stopScheduledJobRunner,
} from "./services/scheduled-jobs.service";
import { closeSocket, initSocket } from "./services/socket.service";

const app = express();

// Railway (and similar hosts) terminate TLS at a reverse proxy and send
// X-Forwarded-For. express-rate-limit requires trust proxy so client IPs
// are derived correctly (avoids ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
app.set("trust proxy", 1);

// Local provider creates its root on first use; ensure dir exists for local default.
if (!fs.existsSync(env.MEDIA_STORAGE_PATH)) {
  fs.mkdirSync(env.MEDIA_STORAGE_PATH, { recursive: true });
}

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
  })
);
app.use(
  express.json({
    limit: "2mb",
    // Keep the raw bytes around so webhook signature verification (HMAC over
    // the exact payload Meta sent) works regardless of JSON re-serialization.
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = Buffer.from(buf);
    },
  })
);

// Correlate audit + logs across a single HTTP request
app.use((req, res, next) => {
  const id = ensureRequestId(req);
  res.setHeader("x-request-id", id);
  next();
});
// Media is NOT publicly browsable — only via signed /media/:filename URLs.
app.use("/media", mediaRoutes);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public: basic liveness probe (no auth, unaffected by rate limiting)
app.use("/health", healthRoutes);

// Public: Meta webhook + auth
app.use("/webhook", webhookRoutes);
app.use("/auth", authRoutes);

// Protected API
app.use(apiLimiter);
app.use("/messages", requireAuth, messagesRoutes);
app.use("/contacts", requireAuth, contactsRoutes);
app.use("/users", requireAuth, usersRoutes);
app.use("/tags", requireAuth, tagsRoutes);
app.use("/conversations", requireAuth, conversationsRoutes);
app.use("/templates", requireAuth, templatesRoutes);
app.use("/contact-lists", requireAuth, contactListsRoutes);
app.use("/campaigns", requireAuth, campaignsRoutes);
app.use("/flows", requireAuth, flowsRoutes);
app.use("/knowledge", requireAuth, knowledgeRoutes);
app.use("/ai-settings", requireAuth, aiSettingsRoutes);
app.use("/analytics", requireAuth, analyticsRoutes);
app.use("/webhook-subscriptions", requireAuth, webhookSubscriptionsRoutes);
app.use("/whatsapp/channels", whatsappChannelsRoutes);
app.use("/integrations/google-sheets", requireAuth, googleSheetsRoutes);
app.use("/settings", settingsRoutes);
app.use("/appointments", requireAuth, appointmentsRoutes);
app.use("/audit", auditRoutes);

// Last-resort error handler: log to SystemError and respond generically.
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction
  ) => {
    const message = error instanceof Error ? error.message : "Unhandled error";
    console.error("[server] Unhandled error:", error);
    void logSystemError({
      source: "express",
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

const server = http.createServer(app);
initSocket(server);

function closeHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const { shutdown: gracefulShutdown } = createGracefulShutdownHandler({
  stopScheduledJobRunner,
  closeSocket,
  closeHttpServer,
  disconnectPrisma: () => prisma.$disconnect(),
  exit: (code) => process.exit(code),
});

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

function listenAsync(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    // Bind all interfaces so Railway/Render can reach the process (not localhost-only).
    server.listen(port, "0.0.0.0");
  });
}

async function startWithRetry(maxAttempts = 5): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await bootstrapApp();
      await listenAsync(env.PORT);
      console.log(`[server] Listening on http://localhost:${env.PORT}`);
      console.log(`[server] CORS origin: ${env.CLIENT_ORIGIN}`);
      const { mediaStorageRootHint, getMediaStorageProvider } = await import(
        "./services/media"
      );
      console.log(
        `[server] Media storage (${getMediaStorageProvider().name}): ${mediaStorageRootHint()}`
      );
      registerFlowJobHandlers();
      startScheduledJobRunner();
      const { resumeInterruptedCampaigns } = await import(
        "./services/broadcast.service"
      );
      await resumeInterruptedCampaigns();
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 15000);
      console.error(
        `[bootstrap] Attempt ${attempt}/${maxAttempts} failed:`,
        message
      );
      if (message.includes("EADDRINUSE")) {
        console.error(
          `[bootstrap] Port ${env.PORT} is busy. Close the old server process, then retry.`
        );
      }
      try {
        server.close();
      } catch {
        // ignore
      }
      if (attempt < maxAttempts) {
        console.log(`[bootstrap] Retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  console.error("[bootstrap] Failed after retries:", lastError);
  process.exit(1);
}

void startWithRetry();
