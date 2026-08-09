/**
 * Diagnose Multi-WA channel credentials (masks tokens).
 * node scripts/check-wa-channel.js [optionalRecipientPhone]
 */
require("dotenv").config();
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient();
const DEFAULT_ID = "wa_channel_default_kadina";

function mask(t) {
  if (!t) return "(empty)";
  if (t.length < 12) return "***";
  return `${t.slice(0, 6)}…${t.slice(-4)} len=${t.length}`;
}

function isPlaceholder(value) {
  return (
    !value ||
    value === "REPLACE_ME" ||
    value.startsWith("REPLACE_") ||
    value.startsWith("PENDING_SEED")
  );
}

async function main() {
  const to = process.argv[2] || null;
  const channel = await p.whatsAppChannel.findUnique({
    where: { id: DEFAULT_ID },
  });
  const settings = await p.clinicSettings.findFirst();
  const envToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const envPnid = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const dbSettingsToken = settings?.whatsappAccessToken || "";
  const dbSettingsPnid = settings?.whatsappPhoneNumberId || "";

  console.log("=== Sources (masked) ===");
  console.log("channel.id", channel?.id || "(missing)");
  console.log("channel.status", channel?.status, "active=", channel?.isActive);
  console.log("channel.phoneNumberId", channel?.phoneNumberId || "(empty)");
  console.log("channel.token", mask(channel?.accessToken));
  console.log("clinicSettings.token", mask(dbSettingsToken));
  console.log("clinicSettings.pnid", dbSettingsPnid || "(empty)");
  console.log("env.token", mask(envToken));
  console.log("env.pnid", envPnid || "(empty)");

  if (!channel) {
    console.log("RESULT", "NO_CHANNEL_ROW");
    process.exit(1);
  }

  const channelToken = channel.accessToken || "";
  const envMatchesChannel =
    !isPlaceholder(envToken) && envToken === channelToken;
  const settingsMatchesChannel =
    !isPlaceholder(dbSettingsToken) && dbSettingsToken === channelToken;

  console.log("env_matches_channel", envMatchesChannel);
  console.log("settings_matches_channel", settingsMatchesChannel);

  // Prefer syncing newer non-placeholder ENV/settings into channel when mismatch
  let syncSource = null;
  if (!isPlaceholder(envToken) && envToken !== channelToken) {
    syncSource = "ENV";
  } else if (
    !isPlaceholder(dbSettingsToken) &&
    dbSettingsToken !== channelToken
  ) {
    syncSource = "ClinicSettings";
  }

  if (syncSource) {
    console.log(
      "MISMATCH: app sends with WhatsAppChannel token, but",
      syncSource,
      "has a different token. Syncing channel from",
      syncSource
    );
    const nextToken = syncSource === "ENV" ? envToken : dbSettingsToken;
    const nextPnid =
      (syncSource === "ENV" ? envPnid : dbSettingsPnid) ||
      channel.phoneNumberId;
    await p.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        accessToken: nextToken,
        phoneNumberId: nextPnid,
        status: "PENDING",
      },
    });
    channel.accessToken = nextToken;
    channel.phoneNumberId = nextPnid;
    console.log("SYNCED channel token from", syncSource, mask(nextToken));
  }

  const token = channel.accessToken;
  const phoneId = channel.phoneNumberId;

  try {
    const { data, status } = await axios.get(
      `https://graph.facebook.com/v20.0/${phoneId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: "id,display_phone_number,verified_name" },
        timeout: 15000,
      }
    );
    console.log("TOKEN_CHECK OK", status, JSON.stringify(data));
    await p.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        status: "CONNECTED",
        ...(data.display_phone_number
          ? { phoneNumber: String(data.display_phone_number).replace(/[^\d+]/g, "") }
          : {}),
      },
    });
  } catch (e) {
    console.log(
      "TOKEN_CHECK FAIL",
      e.response?.status,
      JSON.stringify(e.response?.data || e.message)
    );
    await p.whatsAppChannel.update({
      where: { id: channel.id },
      data: { status: "ERROR" },
    });
  }

  if (to) {
    try {
      const { data, status } = await axios.post(
        `https://graph.facebook.com/v20.0/${phoneId}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: "اختبار قناة كادينا " + new Date().toISOString() },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );
      console.log("SEND_TEST OK", status, JSON.stringify(data));
    } catch (e) {
      console.log(
        "SEND_TEST FAIL",
        e.response?.status,
        JSON.stringify(e.response?.data || e.message)
      );
    }
  } else {
    console.log("SEND_TEST skipped (pass recipient phone as argv to test send)");
  }

  const recent = await p.message.findMany({
    where: { direction: "outbound" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      status: true,
      errorMessage: true,
      createdAt: true,
      type: true,
    },
  });
  console.log(
    "RECENT_OUTBOUND",
    recent
      .map(
        (m) =>
          `${m.createdAt.toISOString()} ${m.status} type=${m.type} ERR=${(m.errorMessage || "").slice(0, 120)}`
      )
      .join("\n")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
