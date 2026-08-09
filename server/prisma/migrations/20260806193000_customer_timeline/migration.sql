-- CreateTable TimelineEvent (customer-scoped unified timeline)
CREATE TABLE IF NOT EXISTS "TimelineEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "performedByUserId" TEXT,
    "performedByName" TEXT,
    "performedByRole" TEXT,
    "actorType" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TimelineEvent_contactId_createdAt_idx"
  ON "TimelineEvent"("contactId", "createdAt");

CREATE INDEX IF NOT EXISTS "TimelineEvent_contactId_eventType_createdAt_idx"
  ON "TimelineEvent"("contactId", "eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "TimelineEvent_conversationId_createdAt_idx"
  ON "TimelineEvent"("conversationId", "createdAt");

CREATE INDEX IF NOT EXISTS "TimelineEvent_actorType_idx"
  ON "TimelineEvent"("actorType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TimelineEvent_contactId_fkey'
  ) THEN
    ALTER TABLE "TimelineEvent"
      ADD CONSTRAINT "TimelineEvent_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TimelineEvent_performedByUserId_fkey'
  ) THEN
    ALTER TABLE "TimelineEvent"
      ADD CONSTRAINT "TimelineEvent_performedByUserId_fkey"
      FOREIGN KEY ("performedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
