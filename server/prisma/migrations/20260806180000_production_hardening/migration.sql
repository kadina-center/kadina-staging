-- Production Hardening (R1)
-- CRM fields, conversation locking, message flags, idempotency, audit trail,
-- login history, appointments, durable scheduled jobs, and error logs.

-- AlterTable Contact (CRM fields)
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "doctor" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "treatment" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "visitCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "leadSource" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "lastAppointmentAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "lastAgentId" TEXT;
CREATE INDEX IF NOT EXISTS "Contact_lastAgentId_idx" ON "Contact"("lastAgentId");

-- AlterTable Message (local flags)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "starred" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Inbound idempotency: dedupe any pre-existing duplicate waMessageId rows
-- (keeps the earliest row) before enforcing uniqueness.
WITH ranked AS (
  SELECT "id",
    ROW_NUMBER() OVER (
      PARTITION BY "waMessageId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Message"
  WHERE "waMessageId" IS NOT NULL
)
DELETE FROM "Message" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS "Message_waMessageId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "Message_waMessageId_key" ON "Message"("waMessageId");

-- AlterTable Conversation (soft lock)
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lockedById" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Conversation_lockedById_idx" ON "Conversation"("lockedById");

-- CreateTable AuditLog
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateTable LoginHistory
CREATE TABLE IF NOT EXISTS "LoginHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LoginHistory_userId_createdAt_idx" ON "LoginHistory"("userId", "createdAt");

-- CreateTable Appointment
CREATE TABLE IF NOT EXISTS "Appointment" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "agentId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Appointment_contactId_scheduledAt_idx" ON "Appointment"("contactId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "Appointment_status_idx" ON "Appointment"("status");
CREATE INDEX IF NOT EXISTS "Appointment_agentId_idx" ON "Appointment"("agentId");

-- CreateTable ScheduledJob
CREATE TABLE IF NOT EXISTS "ScheduledJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduledJob_status_runAt_idx" ON "ScheduledJob"("status", "runAt");
CREATE INDEX IF NOT EXISTS "ScheduledJob_type_idx" ON "ScheduledJob"("type");

-- CreateTable SystemError
CREATE TABLE IF NOT EXISTS "SystemError" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemError_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SystemError_source_createdAt_idx" ON "SystemError"("source", "createdAt");

-- CreateTable DeadLetterMessage
CREATE TABLE IF NOT EXISTS "DeadLetterMessage" (
    "id" TEXT NOT NULL,
    "originalType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetterMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeadLetterMessage_createdAt_idx" ON "DeadLetterMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "DeadLetterMessage_originalType_idx" ON "DeadLetterMessage"("originalType");

-- AddForeignKey (idempotent via existence checks; ADD CONSTRAINT has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Contact_lastAgentId_fkey') THEN
    ALTER TABLE "Contact" ADD CONSTRAINT "Contact_lastAgentId_fkey" FOREIGN KEY ("lastAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_lockedById_fkey') THEN
    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_actorId_fkey') THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoginHistory_userId_fkey') THEN
    ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_contactId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_agentId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
