-- Expand AuditLog for Audit Center (backward-compatible)
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "performedByName" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "performedByRole" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorType" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "oldValues" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "newValues" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "metadata" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_status_createdAt_idx" ON "AuditLog"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_requestId_idx" ON "AuditLog"("requestId");
