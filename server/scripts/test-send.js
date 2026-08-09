require("dotenv").config();
const axios = require("axios");

async function main() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  console.log("TOKEN_LEN", token ? token.length : 0);
  console.log("PHONE_NUMBER_ID", phoneNumberId);
  console.log("TOKEN_PREFIX", token ? token.slice(0, 8) : "missing");

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: "967730474000",
        type: "text",
        text: { body: "test from diagnostics" },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
    console.log("SEND_OK", JSON.stringify(data));
  } catch (error) {
    const meta = error.response?.data;
    console.log("STATUS", error.response?.status);
    console.log("META_ERROR", JSON.stringify(meta, null, 2));
  }
}

main();
