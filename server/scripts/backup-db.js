/**
 * Database backup script.
 *
 * Prefers `pg_dump` (plain SQL dump) when available.
 * Falls back to JSON of key tables via Prisma.
 *
 * SECURITY (JSON fallback):
 * - WhatsAppChannel.accessToken is REDACTED (not stored as plaintext).
 * - ClinicSettings.whatsappAccessToken is REDACTED.
 * - WebhookSubscription.secret is REDACTED.
 * - User.passwordHash is REDACTED.
 * pg_dump includes full secrets — treat .sql backups as confidential and store off-box.
 *
 * Usage: node scripts/backup-db.js
 */
require("dotenv").config();
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const BACKUP_DIR = path.resolve(__dirname, "..", "backups");
const REDACTED = "[REDACTED]";

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function tryPgDump(databaseUrl, outFile) {
  const result = spawnSync(
    "pg_dump",
    [
      databaseUrl,
      "--format=plain",
      "--no-owner",
      "--no-privileges",
      "-f",
      outFile,
    ],
    {
      stdio: ["ignore", "inherit", "inherit"],
    }
  );

  if (result.error) {
    if (result.error.code === "ENOENT") return false;
    throw result.error;
  }

  return result.status === 0;
}

function redactUsers(rows) {
  return (rows || []).map((u) => ({
    ...u,
    passwordHash: REDACTED,
  }));
}

function redactChannels(rows) {
  return (rows || []).map((ch) => ({
    ...ch,
    accessToken: REDACTED,
  }));
}

function redactClinicSettings(rows) {
  return (rows || []).map((s) => ({
    ...s,
    whatsappAccessToken: s.whatsappAccessToken ? REDACTED : s.whatsappAccessToken,
    whatsappVerifyToken: s.whatsappVerifyToken ? REDACTED : s.whatsappVerifyToken,
  }));
}

function redactWebhookSubs(rows) {
  return (rows || []).map((w) => ({
    ...w,
    secret: REDACTED,
  }));
}

async function jsonFallbackBackup(outFile) {
  const prisma = new PrismaClient();
  try {
    const [
      users,
      whatsAppChannels,
      contacts,
      conversations,
      messages,
      tags,
      notes,
      appointments,
      templates,
      contactLists,
      campaigns,
      campaignRecipients,
      flows,
      flowSteps,
      flowExecutions,
      timelineEvents,
      scheduledJobs,
      clinicSettings,
      auditLogs,
      loginHistory,
      webhookSubscriptions,
      aiAgentSettings,
      knowledgeDocuments,
      knowledgeChunks,
      systemErrors,
      deadLetterMessages,
    ] = await Promise.all([
      prisma.user.findMany(),
      prisma.whatsAppChannel.findMany(),
      prisma.contact.findMany(),
      prisma.conversation.findMany(),
      prisma.message.findMany(),
      prisma.tag.findMany(),
      prisma.note.findMany(),
      prisma.appointment.findMany(),
      prisma.template.findMany(),
      prisma.contactList.findMany(),
      prisma.campaign.findMany(),
      prisma.campaignRecipient.findMany(),
      prisma.flow.findMany(),
      prisma.flowStep.findMany(),
      prisma.flowExecution.findMany(),
      prisma.timelineEvent.findMany(),
      prisma.scheduledJob.findMany(),
      prisma.clinicSettings.findMany(),
      prisma.auditLog.findMany(),
      prisma.loginHistory.findMany(),
      prisma.webhookSubscription.findMany(),
      prisma.aiAgentSettings.findMany(),
      prisma.knowledgeDocument.findMany(),
      prisma.knowledgeChunk.findMany(),
      prisma.systemError.findMany(),
      prisma.deadLetterMessage.findMany(),
    ]);

    const dump = {
      exportedAt: new Date().toISOString(),
      format: "kadina-json-backup-v2",
      note:
        "JSON fallback. Secrets redacted (WA accessToken, passwordHash, webhook secret, clinic WA token). " +
        "Restore of WhatsAppChannel requires re-entering access tokens via Admin → WhatsApp Channels. " +
        "Prefer pg_dump for full confidential backups stored securely off-box.",
      tables: {
        users: redactUsers(users),
        whatsAppChannels: redactChannels(whatsAppChannels),
        contacts,
        conversations,
        messages,
        tags,
        notes,
        appointments,
        templates,
        contactLists,
        campaigns,
        campaignRecipients,
        flows,
        flowSteps,
        flowExecutions,
        timelineEvents,
        scheduledJobs,
        clinicSettings: redactClinicSettings(clinicSettings),
        auditLogs,
        loginHistory,
        webhookSubscriptions: redactWebhookSubs(webhookSubscriptions),
        aiAgentSettings,
        knowledgeDocuments,
        knowledgeChunks,
        systemErrors,
        deadLetterMessages,
      },
      counts: {
        users: users.length,
        whatsAppChannels: whatsAppChannels.length,
        contacts: contacts.length,
        conversations: conversations.length,
        messages: messages.length,
        timelineEvents: timelineEvents.length,
        campaigns: campaigns.length,
        flows: flows.length,
      },
    };

    const json = JSON.stringify(dump, null, 2);
    if (/EAA[A-Za-z0-9]+/.test(json) || json.includes("accessToken\": \"EAA")) {
      // Belt-and-suspenders: never write obvious Meta tokens into JSON backup
      console.error(
        "[backup] Refusing to write JSON: possible plaintext token detected after redaction"
      );
      process.exit(1);
    }

    fs.writeFileSync(outFile, json, "utf8");
    console.log(`[backup] JSON export written to ${outFile}`);
    console.log(
      `[backup] counts channels=${dump.counts.whatsAppChannels} contacts=${dump.counts.contacts} conversations=${dump.counts.conversations} (tokens redacted)`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  ensureBackupDir();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[backup] DATABASE_URL is not set — cannot back up.");
    process.exit(1);
  }

  const ts = timestamp();
  const forceJson = process.argv.includes("--json");

  if (forceJson) {
    const jsonFile = path.join(BACKUP_DIR, `backup-${ts}.json`);
    console.log("[backup] --json: writing redacted JSON fallback...");
    await jsonFallbackBackup(jsonFile);
  } else {
    const sqlFile = path.join(BACKUP_DIR, `backup-${ts}.sql`);
    console.log("[backup] Attempting pg_dump...");
    let pgDumpSucceeded = false;
    try {
      pgDumpSucceeded = tryPgDump(databaseUrl, sqlFile);
    } catch (error) {
      console.error("[backup] pg_dump errored:", error.message);
    }

    if (pgDumpSucceeded) {
      console.log(`[backup] pg_dump completed successfully: ${sqlFile}`);
      console.log(
        "[backup] WARNING: SQL dump contains secrets (tokens/password hashes). Store securely off-box."
      );
    } else {
      if (fs.existsSync(sqlFile)) {
        fs.unlinkSync(sqlFile);
      }
      console.warn(
        "[backup] pg_dump not available (or failed) — falling back to JSON (secrets redacted)."
      );
      const jsonFile = path.join(BACKUP_DIR, `backup-${ts}.json`);
      await jsonFallbackBackup(jsonFile);
    }
  }

  const uploadsSrc = path.resolve(__dirname, "..", "uploads");
  if (fs.existsSync(uploadsSrc)) {
    const uploadsDest = path.join(BACKUP_DIR, `uploads-${ts}`);
    fs.cpSync(uploadsSrc, uploadsDest, { recursive: true });
    console.log(`[backup] uploads copied to ${uploadsDest}`);
  } else {
    console.log("[backup] no uploads/ directory to copy");
  }
}

main().catch((error) => {
  console.error("[backup] Failed:", error);
  process.exit(1);
});
