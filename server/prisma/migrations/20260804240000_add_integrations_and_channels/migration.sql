-- DropIndex
DROP INDEX IF EXISTS "Contact_phone_key";

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "Contact" ADD COLUMN "channelUserId" TEXT;

-- Backfill channelUserId from phone for existing WhatsApp contacts
UPDATE "Contact" SET "channelUserId" = "phone" WHERE "channelUserId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Contact_channel_phone_key" ON "Contact"("channel", "phone");

-- CreateIndex
CREATE INDEX "Contact_channel_channelUserId_idx" ON "Contact"("channel", "channelUserId");

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);
