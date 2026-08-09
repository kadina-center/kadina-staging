-- Assignment metadata for visibility / audit (non-breaking)
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "assignedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Conversation_assignedByUserId_idx" ON "Conversation"("assignedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_assignedByUserId_fkey'
  ) THEN
    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_assignedByUserId_fkey"
      FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
