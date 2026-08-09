import { prisma } from "../lib/prisma";

export type LogSystemErrorInput = {
  source: string;
  message: string;
  stack?: string | null;
  meta?: unknown;
};

/** Fire-and-forget system error logger. Never throws. */
export async function logSystemError(input: LogSystemErrorInput): Promise<void> {
  try {
    await prisma.systemError.create({
      data: {
        source: input.source,
        message: input.message.slice(0, 4000),
        stack: input.stack ? input.stack.slice(0, 8000) : null,
        meta:
          input.meta === undefined || input.meta === null
            ? null
            : JSON.stringify(input.meta),
      },
    });

    // Mirror important server errors into Audit Center (non-blocking)
    const { logAudit, AuditAction, AuditEntity } = await import(
      "./audit.service"
    );
    void logAudit({
      action: AuditAction.UPDATE,
      entityType: AuditEntity.SYSTEM,
      actorType: "SYSTEM",
      status: "FAILED",
      metadata: {
        error: input.message.slice(0, 500),
        source: input.source,
        ...(typeof input.meta === "object" && input.meta
          ? (input.meta as object)
          : {}),
      },
    });
  } catch (error) {
    console.error("[error-log] Failed to write system error:", error);
  }
}

export type LogDeadLetterInput = {
  originalType: string;
  payload: unknown;
  errorMessage: string;
  retryCount?: number;
};

/** Records an event/message that exhausted its retries. Never throws. */
export async function logDeadLetter(input: LogDeadLetterInput): Promise<void> {
  try {
    await prisma.deadLetterMessage.create({
      data: {
        originalType: input.originalType,
        payloadJson: JSON.stringify(input.payload ?? null),
        errorMessage: input.errorMessage.slice(0, 4000),
        retryCount: input.retryCount ?? 0,
      },
    });
  } catch (error) {
    console.error("[error-log] Failed to write dead letter message:", error);
  }
}
