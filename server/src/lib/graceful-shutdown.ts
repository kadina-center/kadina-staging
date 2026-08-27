/**
 * Idempotent graceful shutdown for Railway (SIGTERM) and local Ctrl+C (SIGINT).
 * Inject dependencies so unit tests can verify sequencing without a live server.
 */

export type GracefulShutdownDeps = {
  stopScheduledJobRunner: () => void;
  closeSocket: () => Promise<void>;
  closeHttpServer: () => Promise<void>;
  disconnectPrisma: () => Promise<void>;
  exit: (code: number) => void;
  log?: (message: string) => void;
  /** Force-exit if cleanup hangs (Railway ~30s SIGTERM window). Default 25s. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 25_000;

export type GracefulShutdownHandler = {
  shutdown: (signal: string) => Promise<void>;
  /** True once the first shutdown has been accepted (even if still in progress). */
  isShuttingDown: () => boolean;
};

export function createGracefulShutdownHandler(
  deps: GracefulShutdownDeps
): GracefulShutdownHandler {
  const log = deps.log ?? ((message: string) => console.log(message));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let inProgress: Promise<void> | null = null;

  async function run(signal: string): Promise<void> {
    log(`[shutdown] Received ${signal}, starting graceful shutdown`);

    let forced = false;
    const forceTimer = setTimeout(() => {
      forced = true;
      log(
        `[shutdown] Timed out after ${timeoutMs}ms — forcing exit`
      );
      deps.exit(1);
    }, timeoutMs);

    try {
      log("[shutdown] Stopping scheduled job runner");
      deps.stopScheduledJobRunner();

      log("[shutdown] Closing Socket.IO");
      await deps.closeSocket();

      log("[shutdown] Closing HTTP server");
      await deps.closeHttpServer();

      log("[shutdown] Disconnecting Prisma");
      await deps.disconnectPrisma();

      log("[shutdown] Complete");
      clearTimeout(forceTimer);
      if (!forced) {
        deps.exit(0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[shutdown] Failed: ${message}`);
      clearTimeout(forceTimer);
      if (!forced) {
        deps.exit(1);
      }
    }
  }

  return {
    isShuttingDown: () => inProgress !== null,
    shutdown: (signal: string) => {
      if (inProgress) {
        log(`[shutdown] Already in progress — ignoring ${signal}`);
        return inProgress;
      }
      inProgress = run(signal);
      return inProgress;
    },
  };
}
