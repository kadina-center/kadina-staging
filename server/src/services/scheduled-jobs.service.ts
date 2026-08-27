import { prisma } from "../lib/prisma";
import { logDeadLetter, logSystemError } from "./error-log.service";

/**
 * Durable delayed-job queue. Jobs survive process restarts (unlike a plain
 * in-memory setTimeout) because they're persisted in ScheduledJob and picked
 * up by a periodic poll. Handlers are registered per `type` by whichever
 * service owns that kind of job (e.g. broadcast.service for campaign sends).
 *
 * Multi-instance safety: a job is atomically claimed pending → running before
 * the handler runs. Only the worker whose updateMany count === 1 may execute.
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

export const MAX_ATTEMPTS = 5;
export const POLL_INTERVAL_MS = 15_000;
export const BATCH_SIZE = 20;
/** Jobs stuck in "running" longer than this are returned to "pending". */
export const STALE_RUNNING_MS = 15 * 60 * 1000;

let pollTimer: NodeJS.Timeout | null = null;
let running = false;

/** Pure: only the worker that won the atomic claim may run the handler. */
export function wonAtomicClaim(updateCount: number): boolean {
  return updateCount === 1;
}

/** Pure: whether a running job's updatedAt is past the stale threshold. */
export function isStaleRunning(
  updatedAt: Date,
  now: Date = new Date(),
  staleMs: number = STALE_RUNNING_MS
): boolean {
  return now.getTime() - updatedAt.getTime() >= staleMs;
}

/** Pure: next status after a handler outcome (for unit tests). */
export function nextStatusAfterHandler(opts: {
  success: boolean;
  attemptsAfterFailure: number;
  maxAttempts?: number;
}): "done" | "pending" | "failed" {
  if (opts.success) return "done";
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  return opts.attemptsAfterFailure >= max ? "failed" : "pending";
}

/**
 * Simulate an atomic claim store: first claimer wins (count=1), rest get 0.
 * Models two workers racing on the same pending job.
 */
export function simulateConcurrentClaimsOnOneJob(): {
  first: number;
  second: number;
  winners: number;
} {
  let status = "pending";
  const claim = (): number => {
    if (status !== "pending") return 0;
    status = "running";
    return 1;
  };
  const first = claim();
  const second = claim();
  return {
    first,
    second,
    winners:
      (wonAtomicClaim(first) ? 1 : 0) + (wonAtomicClaim(second) ? 1 : 0),
  };
}

async function recoverStaleRunningJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const result = await prisma.scheduledJob.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "pending",
      lastError: "stale_running_reclaimed",
    },
  });
  if (result.count > 0) {
    console.log(
      `[scheduled-jobs] Reclaimed ${result.count} stale running job(s)`
    );
  }
}

/**
 * Atomically claim a pending job for execution.
 * Returns true only when this worker owns the job.
 */
export async function claimScheduledJob(jobId: string): Promise<boolean> {
  const result = await prisma.scheduledJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "running" },
  });
  return wonAtomicClaim(result.count);
}

async function processDueJobs(): Promise<void> {
  if (running) return;
  running = true;

  try {
    await recoverStaleRunningJobs();

    const due = await prisma.scheduledJob.findMany({
      where: { status: "pending", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      take: BATCH_SIZE,
    });

    for (const job of due) {
      // Claim BEFORE any handler work — never execute unclaimed jobs.
      const claimed = await claimScheduledJob(job.id);
      if (!claimed) {
        continue;
      }

      const handler = handlers.get(job.type);
      if (!handler) {
        console.warn(
          `[scheduled-jobs] No handler registered for type="${job.type}" (job ${job.id}) — returning to pending`
        );
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            status: "pending",
            lastError: `no_handler:${job.type}`,
          },
        });
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
          data: { status: "done", lastError: null },
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
          // Return to pending with backoff so another poll (or instance) can retry.
          await prisma.scheduledJob.update({
            where: { id: job.id },
            data: {
              status: "pending",
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
