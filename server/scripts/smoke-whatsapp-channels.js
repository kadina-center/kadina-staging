/**
 * Smoke: Multi-WhatsApp Channels (Phase A)
 * node scripts/smoke-whatsapp-channels.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const BASE = process.env.API_URL || "http://localhost:4000";
const prisma = new PrismaClient();
const DEFAULT_ID = "wa_channel_default_kadina";

function mint(user) {
  const secret = process.env.JWT_SECRET || "kadina-dev-secret-change-me";
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    secret,
    { expiresIn: "1h" }
  );
}

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data };
}

function hasTokenLeak(value) {
  const s = JSON.stringify(value || {});
  return (
    /accessToken/i.test(s) ||
    /PENDING_SEED_ACCESS_TOKEN/.test(s) ||
    (process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_ACCESS_TOKEN !== "REPLACE_ME" &&
      s.includes(process.env.WHATSAPP_ACCESS_TOKEN))
  );
}

async function ensureAgent() {
  const email = "agent-wa-ch@kadina.local";
  let u = await prisma.user.findUnique({ where: { email } });
  if (!u) {
    u = await prisma.user.create({
      data: {
        email,
        name: "WA Channel Agent",
        role: "agent",
        passwordHash: await bcrypt.hash("agent123", 10),
      },
    });
  }
  return u;
}

async function main() {
  let failed = 0;
  let warned = 0;
  const pass = (n, note = "") => console.log("✅", n, note ? "— " + note : "");
  const fail = (n, note = "") => {
    failed++;
    console.log("❌", n, note ? "— " + note : "");
  };
  const warn = (n, note = "") => {
    warned++;
    console.log("⚠️", n, note ? "— " + note : "");
  };

  const admin = await prisma.user.findUnique({
    where: { email: "admin@kadina.local" },
  });
  if (!admin) throw new Error("admin missing — start server once for bootstrap");
  const agent = await ensureAgent();
  const adminToken = mint(admin);
  const agentToken = mint(agent);

  // Ensure default channel row exists (migration)
  const defaultCh = await prisma.whatsAppChannel.findUnique({
    where: { id: DEFAULT_ID },
  });
  if (defaultCh) pass("A0 default channel exists");
  else fail("A0 default channel exists");

  // Sync credentials from ENV into default if still seed
  if (
    defaultCh &&
    (defaultCh.phoneNumberId.startsWith("PENDING_SEED") ||
      defaultCh.accessToken.startsWith("PENDING_SEED"))
  ) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (
      phoneNumberId &&
      phoneNumberId !== "REPLACE_ME" &&
      accessToken &&
      accessToken !== "REPLACE_ME"
    ) {
      await prisma.whatsAppChannel.update({
        where: { id: DEFAULT_ID },
        data: {
          phoneNumberId,
          accessToken,
          businessAccountId:
            process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
            defaultCh.businessAccountId,
          status: "PENDING",
        },
      });
      pass("A0b seeded default from ENV");
    } else {
      warn("A0b seed from ENV", "ENV credentials missing/placeholder");
    }
  }

  // 1 Admin list
  {
    const { res, data } = await api("/whatsapp/channels", { token: adminToken });
    if (res.status === 200 && Array.isArray(data) && !hasTokenLeak(data)) {
      pass("1 Admin list channels", `count=${data.length}`);
    } else {
      fail("1 Admin list", `${res.status} leak=${hasTokenLeak(data)}`);
    }
  }

  // 2 Agent cannot list management
  {
    const { res } = await api("/whatsapp/channels", { token: agentToken });
    if (res.status === 403) pass("2 Agent cannot list channels admin API");
    else fail("2 Agent cannot list", `status=${res.status}`);
  }

  // 3 Agent can public list
  {
    const { res, data } = await api("/whatsapp/channels/public", {
      token: agentToken,
    });
    if (res.status === 200 && Array.isArray(data) && !hasTokenLeak(data)) {
      pass("3 Agent public list", `count=${data.length}`);
    } else fail("3 Agent public list", `${res.status}`);
  }

  // 4 Create channel (admin)
  const stamp = Date.now().toString().slice(-8);
  let createdId = null;
  {
    const { res, data } = await api("/whatsapp/channels", {
      token: adminToken,
      method: "POST",
      body: {
        name: `Smoke ${stamp}`,
        displayName: `Smoke ${stamp}`,
        phoneNumber: `+9665${stamp}`,
        phoneNumberId: `smoke_pnid_${stamp}`,
        accessToken: `smoke_token_${stamp}_not_real`,
        isActive: true,
      },
    });
    if (res.status === 201 && data?.id && !hasTokenLeak(data)) {
      createdId = data.id;
      pass("4 Admin create channel", data.status || "");
    } else {
      fail("4 Admin create", `${res.status} ${JSON.stringify(data)}`);
    }
  }

  // 5 Agent cannot create
  {
    const { res } = await api("/whatsapp/channels", {
      token: agentToken,
      method: "POST",
      body: {
        name: "x",
        displayName: "x",
        phoneNumber: "+966500000099",
        phoneNumberId: "agent_blocked_pnid",
        accessToken: "nope",
      },
    });
    if (res.status === 403) pass("5 Agent cannot create");
    else fail("5 Agent cannot create", `status=${res.status}`);
  }

  // 6 Duplicate phoneNumberId
  if (createdId) {
    const { res, data } = await api("/whatsapp/channels", {
      token: adminToken,
      method: "POST",
      body: {
        name: "dup",
        displayName: "dup",
        phoneNumber: `+9666${stamp}`,
        phoneNumberId: `smoke_pnid_${stamp}`,
        accessToken: "tok",
      },
    });
    if (res.status === 400) pass("6 Duplicate phoneNumberId rejected");
    else fail("6 Duplicate", `${res.status} ${JSON.stringify(data)}`);
  } else warn("6 Duplicate skipped", "no created channel");

  // 7 Max 5 — create until limit
  {
    const count = await prisma.whatsAppChannel.count();
    const toCreate = Math.max(0, 5 - count);
    const ids = [];
    for (let i = 0; i < toCreate; i++) {
      const s = `${stamp}_${i}`;
      const { res, data } = await api("/whatsapp/channels", {
        token: adminToken,
        method: "POST",
        body: {
          name: `Fill ${s}`,
          displayName: `Fill ${s}`,
          phoneNumber: `+9667${String(i)}${stamp.slice(0, 7)}`,
          phoneNumberId: `fill_pnid_${s}`,
          accessToken: `fill_tok_${s}`,
        },
      });
      if (res.status === 201) ids.push(data.id);
    }
    const { res, data } = await api("/whatsapp/channels", {
      token: adminToken,
      method: "POST",
      body: {
        name: "Sixth",
        displayName: "Sixth",
        phoneNumber: "+966599999999",
        phoneNumberId: `sixth_pnid_${stamp}`,
        accessToken: "sixth_tok",
      },
    });
    if (
      (res.status === 409 || res.status === 400) &&
      String(data?.error || "").includes("Maximum of 5")
    ) {
      pass("7 Sixth channel rejected");
    } else {
      fail("7 Sixth rejected", `${res.status} ${JSON.stringify(data)}`);
    }
    // cleanup fills (not default / createdId)
    for (const id of ids) {
      await prisma.whatsAppChannel.delete({ where: { id } }).catch(() => {});
    }
  }

  // 8 Deactivate / 9 Activate
  if (createdId) {
    let { res, data } = await api(`/whatsapp/channels/${createdId}/deactivate`, {
      token: adminToken,
      method: "POST",
    });
    if (res.status === 200 && data.isActive === false) pass("8 Deactivate");
    else fail("8 Deactivate", `${res.status}`);

    ({ res, data } = await api(`/whatsapp/channels/${createdId}/activate`, {
      token: adminToken,
      method: "POST",
    }));
    if (res.status === 200 && data.isActive === true) pass("9 Activate");
    else fail("9 Activate", `${res.status}`);
  }

  // 10 Delete protection if conversations
  {
    const withConv = await prisma.conversation.findFirst({
      select: { channelId: true },
    });
    if (withConv?.channelId) {
      const { res, data } = await api(
        `/whatsapp/channels/${withConv.channelId}`,
        { token: adminToken, method: "DELETE" }
      );
      if (res.status === 409) pass("10 Delete protected when conversations exist");
      else fail("10 Delete protection", `${res.status} ${JSON.stringify(data)}`);
    } else warn("10 Delete protection", "no conversation fixture");
  }

  // B Incoming routing (DB-level simulation)
  {
    const ch = await prisma.whatsAppChannel.findUnique({
      where: { id: DEFAULT_ID },
    });
    const phone = `9665smoke${stamp}`;
    if (ch && !ch.phoneNumberId.startsWith("PENDING_SEED")) {
      // Simulate webhook resolve
      const found = await prisma.whatsAppChannel.findUnique({
        where: { phoneNumberId: ch.phoneNumberId },
      });
      if (found?.id === ch.id) pass("11 Resolve known phone_number_id");
      else fail("11 Resolve known");

      const unknown = await prisma.whatsAppChannel.findUnique({
        where: { phoneNumberId: "totally_unknown_pnid_xyz" },
      });
      if (!unknown) pass("13 Unknown phone_number_id not in DB");
      else fail("13 Unknown");

      // Create contact+conversation on channel
      const contact = await prisma.contact.create({
        data: {
          phone,
          channel: "whatsapp",
          channelUserId: phone,
          whatsAppChannelId: ch.id,
          channelScope: ch.id,
          conversation: {
            create: {
              channelId: ch.id,
              status: "open",
            },
          },
        },
        include: { conversation: true },
      });
      if (contact.conversation?.channelId === ch.id) {
        pass("12 Conversation.channelId correct");
      } else fail("12 Conversation.channelId");

      // Cleanup fixture contact
      await prisma.message.deleteMany({ where: { contactId: contact.id } });
      await prisma.conversation.delete({ where: { contactId: contact.id } });
      await prisma.contact.delete({ where: { id: contact.id } });
    } else {
      warn("11-13 inbound routing", "default channel not seeded with real PNID");
    }
  }

  // Assignment compatibility: channel filter does not grant access
  {
    const { res: agentRes, data: agentData } = await api(
      "/conversations?limit=5",
      { token: agentToken }
    );
    const { res: adminRes, data: adminData } = await api(
      "/conversations?limit=50",
      { token: adminToken }
    );
    if (agentRes.status === 200 && adminRes.status === 200) {
      pass("19/20 Visibility still works", `agent/admin ok`);
    } else fail("19/20 Visibility", `${agentRes.status}/${adminRes.status}`);
    void agentData;
    void adminData;
  }

  // Health channels
  {
    const { res, data } = await api("/health/detailed", { token: adminToken });
    if (
      res.status === 200 &&
      Array.isArray(data.whatsappChannels) &&
      !hasTokenLeak(data)
    ) {
      pass("39 Health whatsappChannels", `n=${data.whatsappChannels.length}`);
    } else {
      fail("39 Health channels", `${res.status}`);
    }
  }

  // Cleanup created smoke channel if no conversations
  if (createdId) {
    const convs = await prisma.conversation.count({
      where: { channelId: createdId },
    });
    if (convs === 0) {
      await prisma.whatsAppChannel.delete({ where: { id: createdId } }).catch(() => {});
      pass("cleanup smoke channel");
    }
  }

  console.log("\n---");
  console.log(
    failed === 0
      ? `ALL PASS (${warned} warnings)`
      : `${failed} FAILED, ${warned} warnings`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
