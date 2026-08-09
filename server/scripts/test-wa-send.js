require("dotenv").config();
const axios = require("axios");

async function main() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = process.argv[2] || "967730474000";
  if (!token || !phone) {
    console.error("Missing token or phone id");
    process.exit(1);
  }
  const url = `https://graph.facebook.com/v20.0/${phone}/messages`;
  try {
    const { data, status } = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: "اختبار إرسال من كادينا " + new Date().toISOString() },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );
    console.log("OK status", status);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log("FAIL status", e.response?.status);
    console.log(JSON.stringify(e.response?.data || e.message, null, 2));
    process.exit(1);
  }
}

main();
