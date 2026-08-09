require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

async function main() {
  console.log("Subscribing current app token to WABA", WABA_ID);

  const post = await axios.post(
    `https://graph.facebook.com/v20.0/${WABA_ID}/subscribed_apps`,
    null,
    {
      params: { access_token: TOKEN },
      timeout: 20000,
      validateStatus: () => true,
    }
  );
  console.log("POST status", post.status);
  console.log(JSON.stringify(post.data, null, 2));

  const get = await axios.get(
    `https://graph.facebook.com/v20.0/${WABA_ID}/subscribed_apps`,
    {
      params: { access_token: TOKEN },
      timeout: 20000,
      validateStatus: () => true,
    }
  );
  console.log("\nGET subscribed_apps status", get.status);
  console.log(JSON.stringify(get.data, null, 2));

  const apps = get.data?.data || [];
  const ids = apps.map(
    (a) => a.whatsapp_business_api_data?.id || a.id || "?"
  );
  console.log("\nSubscribed app ids:", ids);
  console.log(
    ids.includes("1726057838729282")
      ? "SUCCESS: kadina app is now in subscribed_apps"
      : "NOTE: kadina app id 1726057838729282 still not listed"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
