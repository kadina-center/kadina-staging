require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const axios = require("axios");
const p = new PrismaClient();

function mask(t) {
  if (!t) return "(empty)";
  if (t.length < 12) return "***";
  return `${t.slice(0, 6)}…${t.slice(-6)} len=${t.length}`;
}

(async () => {
  const settings = await p.clinicSettings.findFirst();
  const envToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const dbToken = settings?.whatsappAccessToken || "";
  const effective = dbToken || envToken;
  const phoneId =
    settings?.whatsappPhoneNumberId ||
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    "";

  console.log("DB_TOKEN", mask(dbToken), dbToken ? "OVERRIDES_ENV" : "using_env");
  console.log("ENV_TOKEN", mask(envToken));
  console.log("EFFECTIVE", mask(effective));
  console.log("PHONE_ID", phoneId || "(empty)");

  if (!effective || !phoneId) {
    console.log("MISSING_CONFIG");
    await p.$disconnect();
    process.exit(1);
  }

  try {
    const { data, status } = await axios.get(
      `https://graph.facebook.com/v20.0/${phoneId}`,
      {
        headers: { Authorization: `Bearer ${effective}` },
        params: { fields: "id,display_phone_number,verified_name" },
        timeout: 15000,
      }
    );
    console.log("TOKEN_CHECK OK", status, JSON.stringify(data));
  } catch (e) {
    console.log(
      "TOKEN_CHECK FAIL",
      e.response?.status,
      JSON.stringify(e.response?.data || e.message)
    );
  }

  try {
    const { data, status } = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        messaging_product: "whatsapp",
        to: "967730474000",
        type: "text",
        text: { body: "اختبار توكن كادينا " + new Date().toISOString() },
      },
      {
        headers: {
          Authorization: `Bearer ${effective}`,
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

  const recent = await p.message.findMany({
    where: { direction: "outbound" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      status: true,
      errorMessage: true,
      createdAt: true,
      content: true,
    },
  });
  console.log(
    "RECENT",
    recent
      .map(
        (m) =>
          `${m.createdAt.toISOString()} ${m.status} ${(m.content || "").slice(0, 20)} ERR=${(m.errorMessage || "").slice(0, 80)}`
      )
      .join(" || ")
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
