require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

function mask(t) {
  if (!t) return "(empty)";
  if (t.length < 12) return "***";
  return `${t.slice(0, 6)}...${t.slice(-4)} len=${t.length}`;
}

async function main() {
  const p = new PrismaClient();
  try {
    const s = await p.clinicSettings.findFirst();
    const envTok = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const dbTok = s?.whatsappAccessToken || "";
    const phone =
      s?.whatsappPhoneNumberId ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      "";
    const tok = dbTok || envTok;

    console.log("env_token", mask(envTok));
    console.log("db_token", mask(dbTok));
    console.log("using", dbTok ? "DB (overrides .env)" : "ENV");
    console.log("phone", phone || "(empty)");
    console.log(
      "waba",
      s?.whatsappBusinessAccountId ||
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
        "(empty)"
    );

    if (!tok) {
      console.log("RESULT", "NO_TOKEN");
      return;
    }

    const me = await fetch(
      "https://graph.facebook.com/v21.0/me?fields=id,name&access_token=" +
        encodeURIComponent(tok)
    );
    const meJ = await me.json();
    console.log("me_status", me.status);
    console.log(
      "me",
      meJ.error
        ? `ERROR: ${meJ.error.message} (code=${meJ.error.code})`
        : `OK id=${meJ.id} name=${meJ.name || ""}`
    );

    if (phone) {
      const ph = await fetch(
        `https://graph.facebook.com/v21.0/${phone}?fields=display_phone_number,verified_name,quality_rating&access_token=` +
          encodeURIComponent(tok)
      );
      const phJ = await ph.json();
      console.log("phone_status", ph.status);
      console.log(
        "phone_check",
        phJ.error
          ? `ERROR: ${phJ.error.message} (code=${phJ.error.code})`
          : `OK ${phJ.display_phone_number || ""} ${phJ.verified_name || ""}`
      );
    }

    // debug token endpoint often needs app access token; skip if fails
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
