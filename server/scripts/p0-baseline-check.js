/**
 * P0.0 safe staging diagnostics — no secrets printed.
 * Usage (Railway Console or local with DATABASE_URL):
 *   node scripts/p0-baseline-check.js
 */
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function fp(value) {
  if (!value) return "(empty)";
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function isPlaceholder(value) {
  if (!value) return true;
  const v = String(value).trim();
  return (
    !v ||
    v === "REPLACE_ME" ||
    v === "CHANGE_ME" ||
    v.startsWith("YOUR_") ||
    v === "SEED_TOKEN" ||
    v.includes("placeholder")
  );
}

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS ok
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    table,
    column
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function migrationApplied(name) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at
       FROM "_prisma_migrations"
       WHERE migration_name = $1
       LIMIT 1`,
      name
    );
    return rows?.[0] || null;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

(async () => {
  const report = {
    ok: true,
    checks: {},
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    report.checks.dbReachable = true;
  } catch (error) {
    report.ok = false;
    report.checks.dbReachable = false;
    report.checks.dbError =
      error instanceof Error ? error.message.slice(0, 120) : "db error";
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const editedAt = await columnExists("Message", "editedAt");
  report.checks.messageEditedAtColumn = editedAt;
  if (!editedAt) report.ok = false;

  const mig = await migrationApplied("20260824190000_message_edited_at");
  report.checks.editedAtMigration = mig;

  const channels = await prisma.whatsAppChannel.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      phoneNumberId: true,
      businessAccountId: true,
      status: true,
      isActive: true,
      updatedAt: true,
      lastWebhookAt: true,
      lastMessageAt: true,
      accessToken: true,
    },
  });

  const envTok = process.env.WHATSAPP_ACCESS_TOKEN || "";
  report.checks.channels = channels.map((ch) => ({
    id: ch.id,
    phoneNumberId: ch.phoneNumberId,
    businessAccountId: ch.businessAccountId,
    status: ch.status,
    isActive: ch.isActive,
    updatedAt: ch.updatedAt,
    lastWebhookAt: ch.lastWebhookAt,
    lastMessageAt: ch.lastMessageAt,
    tokenPlaceholder: isPlaceholder(ch.accessToken),
    tokenFingerprint_db: fp(ch.accessToken),
    tokenFingerprint_env: fp(envTok),
    db_equals_env: Boolean(
      ch.accessToken && envTok && ch.accessToken === envTok
    ),
  }));

  const activeConnected = channels.filter(
    (c) => c.isActive && c.status === "CONNECTED" && !isPlaceholder(c.accessToken)
  );
  report.checks.messagingReady = activeConnected.length > 0;
  if (!report.checks.messagingReady) report.ok = false;

  const recentInbound = await prisma.message.findFirst({
    where: { direction: "inbound" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, type: true, status: true },
  });
  report.checks.lastInbound = recentInbound;

  const recentOutbound = await prisma.message.findFirst({
    where: { direction: "outbound" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, type: true, status: true },
  });
  report.checks.lastOutbound = recentOutbound;

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(report.ok ? 0 : 2);
})().catch(async (error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    })
  );
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
