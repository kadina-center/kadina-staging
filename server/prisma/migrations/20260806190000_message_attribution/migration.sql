-- AlterTable Message: snapshot attribution for outbound messages
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "createdByRole" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "senderType" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "senderAvatar" TEXT;

-- AlterTable User: optional avatar for attribution snapshots
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;

CREATE INDEX IF NOT EXISTS "Message_createdByUserId_idx" ON "Message"("createdByUserId");
CREATE INDEX IF NOT EXISTS "Message_senderType_idx" ON "Message"("senderType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Message_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "Message"
      ADD CONSTRAINT "Message_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
