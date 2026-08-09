/**
 * Minimal JSON restore for fallback backups created by backup-db.js.
 * Prefer psql restore of .sql dumps in production.
 *
 * WhatsAppChannel.accessToken values that are "[REDACTED]" are restored as
 * PENDING placeholders — re-enter real tokens via Admin → WhatsApp Channels.
 *
 * Usage: node scripts/restore-json.js backups/backup-....json
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const REDACTED = "[REDACTED]";

function sanitizeChannel(row) {
  if (!row) return row;
  const accessToken =
    !row.accessToken || row.accessToken === REDACTED
      ? "PENDING_SEED_ACCESS_TOKEN"
      : row.accessToken;
  return { ...row, accessToken };
}

function sanitizeUser(row) {
  if (!row) return row;
  if (!row.passwordHash || row.passwordHash === REDACTED) {
    return { ...row, passwordHash: "" };
  }
  return row;
}

function sanitizeClinic(row) {
  if (!row) return row;
  return {
    ...row,
    whatsappAccessToken:
      row.whatsappAccessToken === REDACTED ? null : row.whatsappAccessToken,
    whatsappVerifyToken:
      row.whatsappVerifyToken === REDACTED ? null : row.whatsappVerifyToken,
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/restore-json.js <backup.json>");
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error("File not found:", abs);
    process.exit(1);
  }

  const dump = JSON.parse(fs.readFileSync(abs, "utf8"));
  const tables = dump.tables || {};
  const prisma = new PrismaClient();

  try {
    const upsertMany = async (model, rows, mapRow) => {
      if (!Array.isArray(rows) || !rows.length) return 0;
      let n = 0;
      for (const raw of rows) {
        const row = mapRow ? mapRow(raw) : raw;
        try {
          await model.create({ data: row });
          n += 1;
        } catch {
          // ignore duplicates
        }
      }
      return n;
    };

    console.log(
      "users",
      await upsertMany(prisma.user, tables.users, sanitizeUser)
    );
    console.log(
      "whatsAppChannels",
      await upsertMany(
        prisma.whatsAppChannel,
        tables.whatsAppChannels,
        sanitizeChannel
      )
    );
    console.log("contacts", await upsertMany(prisma.contact, tables.contacts));
    console.log(
      "conversations",
      await upsertMany(prisma.conversation, tables.conversations)
    );
    console.log("messages", await upsertMany(prisma.message, tables.messages));
    console.log("tags", await upsertMany(prisma.tag, tables.tags));
    console.log("notes", await upsertMany(prisma.note, tables.notes));
    console.log(
      "appointments",
      await upsertMany(prisma.appointment, tables.appointments)
    );
    console.log(
      "templates",
      await upsertMany(prisma.template, tables.templates)
    );
    console.log(
      "contactLists",
      await upsertMany(prisma.contactList, tables.contactLists)
    );
    console.log(
      "campaigns",
      await upsertMany(prisma.campaign, tables.campaigns)
    );
    console.log(
      "campaignRecipients",
      await upsertMany(prisma.campaignRecipient, tables.campaignRecipients)
    );
    console.log("flows", await upsertMany(prisma.flow, tables.flows));
    console.log(
      "flowSteps",
      await upsertMany(prisma.flowStep, tables.flowSteps)
    );
    console.log(
      "flowExecutions",
      await upsertMany(prisma.flowExecution, tables.flowExecutions)
    );
    console.log(
      "timelineEvents",
      await upsertMany(prisma.timelineEvent, tables.timelineEvents)
    );
    console.log(
      "scheduledJobs",
      await upsertMany(prisma.scheduledJob, tables.scheduledJobs)
    );
    console.log(
      "clinicSettings",
      await upsertMany(
        prisma.clinicSettings,
        tables.clinicSettings,
        sanitizeClinic
      )
    );
    console.log(
      "auditLogs",
      await upsertMany(prisma.auditLog, tables.auditLogs)
    );
    console.log(
      "knowledgeDocuments",
      await upsertMany(prisma.knowledgeDocument, tables.knowledgeDocuments)
    );
    console.log(
      "knowledgeChunks",
      await upsertMany(prisma.knowledgeChunk, tables.knowledgeChunks)
    );
    console.log(
      "[restore] done — re-enter WhatsApp channel access tokens in Admin UI if redacted"
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
