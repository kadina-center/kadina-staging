-- Rename avatar snapshot column for clearer attribution naming
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Message' AND column_name = 'senderAvatar'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Message' AND column_name = 'createdByAvatar'
  ) THEN
    ALTER TABLE "Message" RENAME COLUMN "senderAvatar" TO "createdByAvatar";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Message' AND column_name = 'createdByAvatar'
  ) THEN
    ALTER TABLE "Message" ADD COLUMN "createdByAvatar" TEXT;
  END IF;
END $$;

-- Normalize legacy lowercase senderType values to UPPERCASE
UPDATE "Message"
SET "senderType" = UPPER("senderType")
WHERE "senderType" IS NOT NULL
  AND "senderType" <> UPPER("senderType");

-- Remove Quick Replies feature entirely
DROP TABLE IF EXISTS "QuickReply";
