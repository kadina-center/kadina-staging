/**
 * Unit tests for idempotent graceful shutdown (no live HTTP/DB).
 * Usage: npx ts-node --transpile-only scripts/test-graceful-shutdown.ts
 */
import { createGracefulShutdownHandler } from "../src/lib/graceful-shutdown";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testIdempotentShutdown(): Promise<void> {
  const phases: string[] = [];
  let exitCode: number | null = null;
  let stopCalls = 0;
  let socketCalls = 0;
  let httpCalls = 0;
  let prismaCalls = 0;

  const { shutdown, isShuttingDown } = createGracefulShutdownHandler({
    timeoutMs: 5_000,
    log: (m) => phases.push(m),
    stopScheduledJobRunner: () => {
      stopCalls += 1;
    },
    closeSocket: async () => {
      socketCalls += 1;
      await delay(40);
    },
    closeHttpServer: async () => {
      httpCalls += 1;
      await delay(20);
    },
    disconnectPrisma: async () => {
      prismaCalls += 1;
    },
    exit: (code) => {
      exitCode = code;
    },
  });

  const first = shutdown("SIGTERM");
  assert(isShuttingDown(), "isShuttingDown true after first signal");
  const second = shutdown("SIGINT");
  assert(first === second, "second signal returns the same in-progress promise");

  await first;

  assert(stopCalls === 1, "stopScheduledJobRunner called once");
  assert(socketCalls === 1, "closeSocket called once");
  assert(httpCalls === 1, "closeHttpServer called once");
  assert(prismaCalls === 1, "disconnectPrisma called once");
  assert(exitCode === 0, "exits with code 0 on success");
  assert(
    phases.some((p) => p.includes("Already in progress — ignoring SIGINT")),
    "logs that second signal was ignored"
  );
  assert(
    phases.some((p) => p.includes("Stopping scheduled job runner")),
    "logs job runner stop"
  );
  assert(
    phases.some((p) => p.includes("Closing Socket.IO")),
    "logs Socket.IO close"
  );
  assert(
    phases.some((p) => p.includes("Closing HTTP server")),
    "logs HTTP close"
  );
  assert(
    phases.some((p) => p.includes("Disconnecting Prisma")),
    "logs Prisma disconnect"
  );
  assert(phases.some((p) => p.includes("Complete")), "logs complete");
}

async function testShutdownOrder(): Promise<void> {
  const order: string[] = [];
  const { shutdown } = createGracefulShutdownHandler({
    timeoutMs: 5_000,
    log: () => undefined,
    stopScheduledJobRunner: () => {
      order.push("jobs");
    },
    closeSocket: async () => {
      order.push("socket");
    },
    closeHttpServer: async () => {
      order.push("http");
    },
    disconnectPrisma: async () => {
      order.push("prisma");
    },
    exit: () => {
      order.push("exit");
    },
  });

  await shutdown("SIGTERM");
  assert(
    order.join(",") === "jobs,socket,http,prisma,exit",
    "shutdown order: jobs → socket → http → prisma → exit"
  );
}

async function main(): Promise<void> {
  await testIdempotentShutdown();
  await testShutdownOrder();
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll graceful-shutdown tests passed");
}

void main();
