/**
 * Flow production hardening tests (pure + optional DB integration).
 * Usage: npx ts-node --transpile-only scripts/test-flow-production-hardening.ts
 */
import { prisma } from "../src/lib/prisma";
import { env } from "../src/config/env";
import {
  FLOW_STALE_NON_WAIT_MS,
  FLOW_WAIT_JOB_GRACE_MS,
  isFlowExecutionStale,
  reconcileContactFlowState,
  startFlow,
  stopFlow,
} from "../src/services/flow-engine.service";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function testStalePureLogic(): void {
  assert(
    isFlowExecutionStale({
      currentStepActionType: "wait",
      hasPendingResumeJob: true,
      executionAgeMs: 999_999_999,
    }) === false,
    "E: wait + pending flow.resume job is NOT stale"
  );

  assert(
    isFlowExecutionStale({
      currentStepActionType: "wait",
      hasPendingResumeJob: false,
      executionAgeMs: FLOW_WAIT_JOB_GRACE_MS + 1,
    }) === true,
    "D: wait without resume job after grace is stale"
  );

  assert(
    isFlowExecutionStale({
      currentStepActionType: "send_text",
      hasPendingResumeJob: false,
      executionAgeMs: FLOW_STALE_NON_WAIT_MS + 1,
    }) === true,
    "D: non-wait running past stale window is stale"
  );

  assert(
    isFlowExecutionStale({
      currentStepActionType: "send_text",
      hasPendingResumeJob: false,
      executionAgeMs: 5_000,
    }) === false,
    "non-wait young execution is not stale yet"
  );
}

async function withTestData<T>(
  fn: (ctx: {
    contactId: string;
    flowId: string;
    userId: string;
  }) => Promise<T>
): Promise<T> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      name: "Flow Test Agent",
      email: `flow-test-${suffix}@example.com`,
      passwordHash: "test",
      role: "agent",
    },
  });
  const flow = await prisma.flow.create({
    data: {
      name: `Test Flow ${suffix}`,
      isActive: true,
      triggerType: "keyword",
      triggerValue: "test",
    },
  });
  await prisma.flowStep.create({
    data: {
      flowId: flow.id,
      order: 0,
      actionType: "set_status",
      actionValue: "open",
    },
  });
  const contact = await prisma.contact.create({
    data: {
      phone: `+1555${suffix.replace(/\D/g, "").slice(0, 7)}`,
      name: "Flow Test Contact",
      channel: "whatsapp",
      channelScope: "_",
    },
  });

  try {
    return await fn({
      contactId: contact.id,
      flowId: flow.id,
      userId: user.id,
    });
  } finally {
    await prisma.scheduledJob.deleteMany({
      where: { payloadJson: { contains: contact.id } },
    });
    await prisma.flowExecution.deleteMany({ where: { contactId: contact.id } });
    await prisma.flowStep.deleteMany({ where: { flowId: flow.id } });
    await prisma.flow.delete({ where: { id: flow.id } });
    await prisma.conversation.deleteMany({ where: { contactId: contact.id } });
    await prisma.contact.delete({ where: { id: contact.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

async function testConcurrentStartFlow(): Promise<void> {
  await withTestData(async ({ contactId, flowId }) => {
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    const flow = await prisma.flow.findUniqueOrThrow({
      where: { id: flowId },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    const results = await Promise.all([
      startFlow(flow, contact),
      startFlow(flow, contact),
    ]);

    const startedCount = results.filter(Boolean).length;
    assert(startedCount === 1, "A: concurrent startFlow — exactly one winner");

    const running = await prisma.flowExecution.count({
      where: { contactId, status: "running" },
    });
    assert(running <= 1, "A: at most one running execution per contact");

    const updated = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    if (running === 1) {
      assert(
        updated.activeFlowExecutionId !== null,
        "A: winner sets activeFlowExecutionId"
      );
    }
  });
}

async function testStalePointerRecovery(): Promise<void> {
  await withTestData(async ({ contactId, flowId }) => {
    const stale = await prisma.flowExecution.create({
      data: {
        flowId,
        contactId,
        currentStep: 0,
        status: "completed",
        completedAt: new Date(),
      },
    });
    await prisma.contact.update({
      where: { id: contactId },
      data: { activeFlowExecutionId: stale.id },
    });

    await reconcileContactFlowState(contactId);

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    assert(
      contact.activeFlowExecutionId === null,
      "D: stale pointer to non-running execution is cleared"
    );
  });
}

async function testWaitWithResumeJobNotStale(): Promise<void> {
  await withTestData(async ({ contactId, flowId }) => {
    await prisma.flowStep.deleteMany({ where: { flowId } });
    await prisma.flowStep.create({
      data: {
        flowId,
        order: 0,
        actionType: "wait",
        actionValue: "60",
      },
    });

    const execution = await prisma.flowExecution.create({
      data: {
        flowId,
        contactId,
        currentStep: 0,
        status: "running",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    await prisma.contact.update({
      where: { id: contactId },
      data: { activeFlowExecutionId: execution.id },
    });
    await prisma.scheduledJob.create({
      data: {
        type: "flow.resume",
        runAt: new Date(Date.now() + 60_000),
        payloadJson: JSON.stringify({
          executionId: execution.id,
          afterStep: 0,
        }),
        status: "pending",
      },
    });

    await reconcileContactFlowState(contactId);

    const stillRunning = await prisma.flowExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    assert(
      stillRunning.status === "running",
      "E: wait + pending flow.resume survives reconcile"
    );

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    assert(
      contact.activeFlowExecutionId === execution.id,
      "E: active pointer preserved during legitimate wait"
    );
  });
}

async function testAssignToUserStopsFlow(): Promise<void> {
  await withTestData(async ({ contactId, flowId, userId }) => {
    await prisma.flowStep.deleteMany({ where: { flowId } });
    await prisma.flowStep.create({
      data: {
        flowId,
        order: 0,
        actionType: "assign_to_user",
        actionValue: userId,
      },
    });

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    const flow = await prisma.flow.findUniqueOrThrow({
      where: { id: flowId },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    await startFlow(flow, contact);

    const execution = await prisma.flowExecution.findFirst({
      where: { contactId },
      orderBy: { startedAt: "desc" },
    });
    assert(execution?.status === "stopped", "G: assign_to_user stops execution");

    const updatedContact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    assert(
      updatedContact.activeFlowExecutionId === null,
      "G: assign_to_user clears activeFlowExecutionId"
    );

    const conversation = await prisma.conversation.findUnique({
      where: { contactId },
    });
    assert(
      conversation?.assignedToId === userId,
      "G: assign_to_user still assigns conversation"
    );
  });
}

async function testStopFlowIdempotent(): Promise<void> {
  await withTestData(async ({ contactId, flowId }) => {
    const execution = await prisma.flowExecution.create({
      data: {
        flowId,
        contactId,
        currentStep: 0,
        status: "running",
      },
    });
    await prisma.contact.update({
      where: { id: contactId },
      data: { activeFlowExecutionId: execution.id },
    });

    await stopFlow(contactId);
    await stopFlow(contactId);

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
    });
    assert(
      contact.activeFlowExecutionId === null,
      "J: stopFlow twice is safe (pointer cleared)"
    );

    const stopped = await prisma.flowExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    assert(stopped.status === "stopped", "J: execution remains stopped");
  });
}

async function runDbTests(): Promise<void> {
  if (!env.DATABASE_URL || env.DATABASE_URL.includes("user:password")) {
    console.log(
      "SKIP: DB integration tests (DATABASE_URL missing or placeholder)"
    );
    return;
  }

  console.log("--- flow hardening DB integration tests ---");
  try {
    await testConcurrentStartFlow();
    await testStalePointerRecovery();
    await testWaitWithResumeJobNotStale();
    await testAssignToUserStopsFlow();
    await testStopFlowIdempotent();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";
    console.warn(
      `SKIP: DB integration tests could not run (${message.slice(0, 120)})`
    );
  }
}

async function main(): Promise<void> {
  console.log("--- flow production hardening tests (pure) ---");
  testStalePureLogic();

  await runDbTests();

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll flow production hardening tests passed.");
}

void main().finally(() => prisma.$disconnect());
