-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN "repliedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN "replyMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_replyMessageId_key" ON "CampaignRecipient"("replyMessageId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_contactId_sentAt_idx" ON "CampaignRecipient"("contactId", "sentAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_repliedAt_idx" ON "CampaignRecipient"("campaignId", "repliedAt");
