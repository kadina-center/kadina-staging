-- Multi-WhatsApp Channels (Phase A)
-- Seed row id is fixed so bootstrap can refresh credentials from ENV/ClinicSettings.

CREATE TABLE "WhatsAppChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "businessAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedUserId" TEXT,
    "lastWebhookAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppChannel_phoneNumberId_key" ON "WhatsAppChannel"("phoneNumberId");
CREATE INDEX "WhatsAppChannel_phoneNumber_idx" ON "WhatsAppChannel"("phoneNumber");
CREATE INDEX "WhatsAppChannel_isActive_idx" ON "WhatsAppChannel"("isActive");
CREATE INDEX "WhatsAppChannel_status_idx" ON "WhatsAppChannel"("status");
CREATE INDEX "WhatsAppChannel_assignedUserId_idx" ON "WhatsAppChannel"("assignedUserId");

ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Placeholder default channel (credentials filled by bootstrap from ENV/ClinicSettings)
INSERT INTO "WhatsAppChannel" (
  "id", "name", "displayName", "phoneNumber", "phoneNumberId", "accessToken",
  "businessAccountId", "status", "isActive", "createdAt", "updatedAt"
) VALUES (
  'wa_channel_default_kadina',
  'Default WhatsApp',
  'Default WhatsApp',
  'unknown',
  'PENDING_SEED_PHONE_NUMBER_ID',
  'PENDING_SEED_ACCESS_TOKEN',
  NULL,
  'PENDING',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Contact: multi-number uniqueness via channelScope
ALTER TABLE "Contact" ADD COLUMN "whatsAppChannelId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "channelScope" TEXT NOT NULL DEFAULT '_';

DROP INDEX IF EXISTS "Contact_channel_phone_key";

UPDATE "Contact"
SET
  "whatsAppChannelId" = 'wa_channel_default_kadina',
  "channelScope" = 'wa_channel_default_kadina'
WHERE "channel" = 'whatsapp';

CREATE UNIQUE INDEX "Contact_channel_phone_channelScope_key"
  ON "Contact"("channel", "phone", "channelScope");

CREATE INDEX "Contact_whatsAppChannelId_idx" ON "Contact"("whatsAppChannelId");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_whatsAppChannelId_fkey"
  FOREIGN KEY ("whatsAppChannelId") REFERENCES "WhatsAppChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Conversation.channelId (required)
ALTER TABLE "Conversation" ADD COLUMN "channelId" TEXT;

UPDATE "Conversation" c
SET "channelId" = COALESCE(
  (SELECT ct."whatsAppChannelId" FROM "Contact" ct WHERE ct."id" = c."contactId"),
  'wa_channel_default_kadina'
);

ALTER TABLE "Conversation" ALTER COLUMN "channelId" SET NOT NULL;

CREATE INDEX "Conversation_channelId_idx" ON "Conversation"("channelId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Campaign.channelId (required)
ALTER TABLE "Campaign" ADD COLUMN "channelId" TEXT;

UPDATE "Campaign" SET "channelId" = 'wa_channel_default_kadina';

ALTER TABLE "Campaign" ALTER COLUMN "channelId" SET NOT NULL;

CREATE INDEX "Campaign_channelId_idx" ON "Campaign"("channelId");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
