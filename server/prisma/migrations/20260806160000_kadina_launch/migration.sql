-- AlterTable Contact
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "crmStatus" TEXT NOT NULL DEFAULT 'patient';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "customNotes" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
CREATE INDEX IF NOT EXISTS "Contact_crmStatus_idx" ON "Contact"("crmStatus");

-- AlterTable Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "replyToMessageId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "replyToWaMessageId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "metaPayload" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;

-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT NOT NULL DEFAULT '';

-- AlterTable Conversation
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "unreadCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastReadAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Conversation_pinned_archived_idx" ON "Conversation"("pinned", "archived");

-- AlterTable Note
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable QuickReply
CREATE TABLE IF NOT EXISTS "QuickReply" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'عام',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable ClinicSettings
CREATE TABLE IF NOT EXISTS "ClinicSettings" (
    "id" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL DEFAULT 'عيادة كادينا',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Aden',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "businessHoursJson" TEXT NOT NULL DEFAULT '{"days":[0,1,2,3,4],"start":"09:00","end":"17:00"}',
    "welcomeMessage" TEXT NOT NULL DEFAULT 'مرحبًا بك في عيادة كادينا. كيف يمكننا مساعدتك؟',
    "awayMessage" TEXT NOT NULL DEFAULT 'شكرًا لتواصلك. نحن خارج أوقات العمل وسنرد عليك في أقرب وقت.',
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "awayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappAccessToken" TEXT,
    "whatsappPhoneNumberId" TEXT,
    "whatsappBusinessAccountId" TEXT,
    "whatsappVerifyToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicSettings_pkey" PRIMARY KEY ("id")
);
