require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN;

function mask(value) {
  if (!value) return "(missing)";
  if (value.length <= 10) return `${value.slice(0, 2)}…(${value.length})`;
  return `${value.slice(0, 6)}…${value.slice(-4)} (len=${value.length})`;
}

async function get(path, params = {}) {
  const url = path.startsWith("http")
    ? path
    : `https://graph.facebook.com/v20.0/${path}`;
  try {
    const { data, status } = await axios.get(url, {
      params: { access_token: TOKEN, ...params },
      timeout: 20000,
      validateStatus: () => true,
    });
    return { status, data };
  } catch (error) {
    return {
      status: 0,
      data: { error: error.message },
    };
  }
}

async function main() {
  console.log("=== LOCAL ENV (masked) ===");
  console.log("WHATSAPP_ACCESS_TOKEN", mask(TOKEN));
  console.log("WHATSAPP_PHONE_NUMBER_ID", PHONE_NUMBER_ID || "(missing)");
  console.log("WHATSAPP_BUSINESS_ACCOUNT_ID", WABA_ID || "(missing)");
  console.log("WHATSAPP_VERIFY_TOKEN", mask(VERIFY));

  if (!TOKEN || TOKEN === "REPLACE_ME") {
    console.log("FATAL: access token missing/placeholder");
    process.exit(1);
  }

  console.log("\n=== 1) debug_token (app ownership) ===");
  // Need app access token for full debug; with user/system token we can still call /me and phone node
  const debug = await get("debug_token", {
    input_token: TOKEN,
  });
  console.log("status", debug.status);
  console.log(JSON.stringify(debug.data, null, 2));

  const appIdFromDebug =
    debug.data?.data?.app_id ||
    debug.data?.data?.application ||
    null;

  console.log("\n=== 2) Phone Number node ===");
  const phone = await get(PHONE_NUMBER_ID, {
    fields: "id,display_phone_number,verified_name,account_mode,quality_rating,webhook_configuration,name_status",
  });
  console.log("status", phone.status);
  console.log(JSON.stringify(phone.data, null, 2));

  console.log("\n=== 3) WABA node ===");
  const waba = await get(WABA_ID, {
    fields: "id,name,currency,timezone_id,message_template_namespace,account_review_status",
  });
  console.log("status", waba.status);
  console.log(JSON.stringify(waba.data, null, 2));

  console.log("\n=== 4) GET /{WABA_ID}/subscribed_apps ===");
  const subscribedApps = await get(`${WABA_ID}/subscribed_apps`);
  console.log("status", subscribedApps.status);
  console.log(JSON.stringify(subscribedApps.data, null, 2));
  const apps = subscribedApps.data?.data || [];
  if (Array.isArray(apps) && apps.length === 0) {
    console.log("RESULT: subscribed_apps is EMPTY []  << likely root cause");
  } else if (Array.isArray(apps)) {
    console.log(`RESULT: subscribed_apps count=${apps.length}`);
  }

  // Try to discover app id via phone ownership if debug failed
  let appId = appIdFromDebug;
  if (!appId && phone.data?.id) {
    // Sometimes /app from token
    const me = await get("me", { fields: "id,name" });
    console.log("\n=== me ===");
    console.log(JSON.stringify(me.data, null, 2));
  }

  if (appId) {
    console.log("\n=== 5) GET /{APP_ID}/subscriptions ===");
    console.log("APP_ID", appId);
    const subs = await get(`${appId}/subscriptions`);
    console.log("status", subs.status);
    console.log(JSON.stringify(subs.data, null, 2));
  } else {
    console.log("\n=== 5) APP_ID unknown from debug_token ===");
    console.log("Trying common field via phone business...");
  }

  // Cross-check: phone belongs to WABA?
  console.log("\n=== 6) WABA phone_numbers list ===");
  const numbers = await get(`${WABA_ID}/phone_numbers`, {
    fields: "id,display_phone_number,verified_name",
  });
  console.log("status", numbers.status);
  console.log(JSON.stringify(numbers.data, null, 2));
  const list = numbers.data?.data || [];
  const match = list.some((n) => String(n.id) === String(PHONE_NUMBER_ID));
  console.log(
    match
      ? "RESULT: PHONE_NUMBER_ID belongs to this WABA"
      : "RESULT: PHONE_NUMBER_ID NOT found under this WABA  << mismatch risk"
  );

  console.log("\n=== SUMMARY ===");
  console.log({
    tokenLooksValid: debug.status === 200 && !debug.data?.error,
    wabaSubscribedAppsEmpty: Array.isArray(apps) && apps.length === 0,
    phoneMatchesWaba: match,
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA_ID,
    appId: appId || null,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
