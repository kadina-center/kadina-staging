import { prisma } from "../lib/prisma";
import { logDeadLetter, logSystemError } from "./error-log.service";

/**
 * Durable delayed-job queue. Jobs survive process restarts (unlike a plain
 * in-memory setTimeout) because they're persisted in ScheduledJob and picked
 * up by a periodic poll. Handlers are registered per `type` by whichever
 * service owns that kind of job (e.g. broadcast.service for campaign sends).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScheduledJobHandler = (payload: any) => Promise<void>;

const handlers = new Map<string, ScheduledJobHandler>();

export function registerJobHandler(
  type: string,
  handler: ScheduledJobHandler
): void {
  handlers.set(type, handler);
}

export async function enqueueScheduledJob(
  type: string,
  runAt: Date,
  payload: unknown
): Promise<string> {
  const job = await prisma.scheduledJob.create({
    data: {
      type,
      runAt,
      payloadJson: JSON.stringify(payload ?? {}),
    },
  });
  return job.id;
}

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 20;

let pollTimer: NodeJS.Timeout | null = null;
let running = false;

async function processDueJobs(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const due = await prisma.scheduledJob.findMany({
      where: { status: "pending", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      take: BATCH_SIZE,
    });

    for (const job of due) {
      const handler = handlers.get(job.type);
      if (!handler) {
        console.warn(
          `[scheduled-jobs] No handler registered for type="${job.type}" (job ${job.id})`
        );
        continue;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(job.payloadJson);
      } catch {
        payload = null;
      }

      try {
        await handler(payload);
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: "done" },
        });
      } catch (error) {
        const attempts = job.attempts + 1;
        const message = error instanceof Error ? error.message : "Job failed";

        if (attempts >= MAX_ATTEMPTS) {
          await prisma.scheduledJob.update({
            where: { id: job.id },
            data: { status: "failed", attempts, lastError: message },
          });
          await logDeadLetter({
            originalType: job.type,
            payload,
            errorMessage: message,
            retryCount: attempts,
          });
          await logSystemError({
            source: "scheduled-jobs",
            message: `Job ${job.id} (${job.type}) exhausted retries: ${message}`,
          });
        } else {
          // Simple linear backoff before the next attempt.
          await prisma.scheduledJob.update({
            where: { id: job.id },
            data: {
              attempts,
              lastError: message,
              runAt: new Date(Date.now() + attempts * 30_000),
            },
          });
        }
      }
    }
  } catch (error) {
    console.error("[scheduled-jobs] poll error:", error);
  } finally {
    running = false;
  }
}

export function startScheduledJobRunner(): void {
  if (pollTimer) return;
  void processDueJobs();
  pollTimer = setInterval(() => void processDueJobs(), POLL_INTERVAL_MS);
  console.log("[scheduled-jobs] runner started");
}

export function stopScheduledJobRunner(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
