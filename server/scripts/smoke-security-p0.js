/**
 * Security Hardening P0 smoke tests
 * Usage: node scripts/smoke-security-p0.js
 * Requires API at API_URL (default http://localhost:4000)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { io } = require("../../client/node_modules/socket.io-client");

const BASE = process.env.API_URL || "http://localhost:4000";
const prisma = new PrismaClient();
const SECRET = process.env.JWT_SECRET || "kadina-dev-secret-change-me";

function mint(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    SECRET,
    { expiresIn: "1h" }
  );
}

async function api(pathname, { token, method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
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
  return { res, data, text };
}

async function ensureAgent(email, name) {
  let u = await prisma.user.findUnique({ where: { email } });
  if (!u) {
    u = await prisma.user.create({
      data: {
        email,
        name,
        role: "agent",
        passwordHash: await bcrypt.hash("agent123", 10),
      },
    });
  } else if (u.role !== "agent") {
    u = await prisma.user.update({
      where: { id: u.id },
      data: { role: "agent", name },
    });
  }
  return u;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitAudit(where, since, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const row = await prisma.auditLog.findFirst({
      where: {
        ...where,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });
    if (row) return row;
    await sleep(250);
  }
  return null;
}

function connectSocket(token) {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 4000,
    });
    const done = (ok, reason) => {
      resolve({ socket, ok, reason });
    };
    socket.on("connect", () => done(true, "connected"));
    socket.on("connect_error", (err) => done(false, err?.message || "error"));
    setTimeout(() => {
      if (!socket.connected) done(false, "timeout");
    }, 4500);
  });
}

async function main() {
  let failed = 0;
  const pass = (n, note = "") =>
    console.log("✅", n, note ? "— " + note : "");
  const fail = (n, note = "") => {
    failed++;
    console.log("❌", n, note ? "— " + note : "");
  };

  console.log("\n=== Security P0 Smoke ===\n");

  const admin = await prisma.user.findUnique({
    where: { email: "admin@kadina.local" },
  });
  if (!admin) throw new Error("admin@kadina.local missing — bootstrap first");

  const ahmed = await ensureAgent("ahmed-sec@kadina.local", "Ahmed Sec");
  const sara = await ensureAgent("sara-sec@kadina.local", "Sara Sec");
  const adminToken = mint(admin);
  const ahmedToken = mint(ahmed);
  const saraToken = mint(sara);

  const channel = await prisma.whatsAppChannel.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!channel) throw new Error("No WhatsAppChannel — bootstrap first");

  // Two contacts/conversations
  const contactA = await prisma.contact.create({
    data: {
      phone: `9665${String(Date.now()).slice(-8)}1`,
      name: "Sec Contact A",
      whatsAppChannelId: channel.id,
    },
  });
  const contactB = await prisma.contact.create({
    data: {
      phone: `9665${String(Date.now()).slice(-8)}2`,
      name: "Sec Contact B",
      whatsAppChannelId: channel.id,
    },
  });
  const convA = await prisma.conversation.create({
    data: {
      contactId: contactA.id,
      channelId: channel.id,
      assignedToId: ahmed.id,
      assignedAt: new Date(),
      assignedByUserId: admin.id,
    },
  });
  const convB = await prisma.conversation.create({
    data: {
      contactId: contactB.id,
      channelId: channel.id,
      assignedToId: sara.id,
      assignedAt: new Date(),
      assignedByUserId: admin.id,
    },
  });

  const apptB = await prisma.appointment.create({
    data: {
      contactId: contactB.id,
      title: "Sec appt B",
      scheduledAt: new Date(Date.now() + 86400000),
      status: "scheduled",
    },
  });

  const noteB = await prisma.note.create({
    data: {
      conversationId: convB.id,
      authorId: sara.id,
      content: "secret note for sara",
    },
  });

  // ---------- AUTH ----------
  console.log("-- AUTH --");
  {
    const { res } = await api("/conversations?limit=5", { token: adminToken });
    if (res.ok) pass("Admin access");
    else fail("Admin access", `http=${res.status}`);
  }
  {
    const { res, data } = await api("/conversations?limit=50", {
      token: ahmedToken,
    });
    const items = data?.items || data || [];
    const ids = Array.isArray(items) ? items.map((c) => c.id) : [];
    if (res.ok && ids.includes(convA.id) && !ids.includes(convB.id))
      pass("Agent access scoped to assigned");
    else fail("Agent access scoped to assigned", `http=${res.status}`);
  }
  {
    const { ok, reason, socket } = await connectSocket(null);
    if (!ok) pass("Socket without JWT rejected", reason);
    else fail("Socket without JWT rejected");
    socket.close();
  }
  {
    const { ok, reason, socket } = await connectSocket("not.a.jwt");
    if (!ok) pass("Socket invalid JWT rejected", reason);
    else fail("Socket invalid JWT rejected");
    socket.close();
  }

  // ---------- PII EXPORT ----------
  console.log("-- PII --");
  {
    const since = new Date();
    const { res, text } = await api("/analytics/export", {
      token: adminToken,
    });
    if (res.ok && typeof text === "string" && text.includes("contact_phone"))
      pass("Admin analytics export 200");
    else fail("Admin analytics export 200", `http=${res.status}`);
    const audit = await waitAudit(
      {
        actorId: admin.id,
        action: "EXPORT",
        status: "SUCCESS",
      },
      since
    );
    if (audit) pass("Admin export audited");
    else fail("Admin export audited");
  }
  {
    const since = new Date();
    const { res, data } = await api("/analytics/export?all=true", {
      token: ahmedToken,
    });
    if (res.status === 403) pass("Agent analytics export 403");
    else fail("Agent analytics export 403", `http=${res.status}`);
    const body = JSON.stringify(data || "");
    if (!/\b9665\d{8}/.test(body) && !/contact_phone/.test(body))
      pass("Agent export response has no phones");
    else fail("Agent export response has no phones");
    const audit = await waitAudit(
      {
        actorId: ahmed.id,
        status: "FAILED",
      },
      since
    );
    if (audit && (audit.metadata || "").includes("admin_required"))
      pass("Agent export denial audited");
    else fail("Agent export denial audited");
  }
  {
    const { res } = await api("/integrations/google-sheets/export", {
      token: ahmedToken,
      method: "POST",
      body: { spreadsheetId: "x", accessToken: "y" },
    });
    if (res.status === 403) pass("Agent google-sheets export 403");
    else fail("Agent google-sheets export 403", `http=${res.status}`);
  }
  {
    const { res } = await api("/contact-lists/nonexistent", {
      token: ahmedToken,
    });
    if (res.status === 403) pass("Agent contact-list detail 403");
    else fail("Agent contact-list detail 403", `http=${res.status}`);
  }

  // ---------- AI IDOR ----------
  console.log("-- AI IDOR --");
  {
    const { res } = await api("/ai/copilot-suggestions", {
      token: ahmedToken,
      method: "POST",
      body: { conversationId: convA.id },
    });
    // 200 with suggestions or 500 if AI key missing — not 404/403
    if (res.status !== 404 && res.status !== 403)
      pass("Ahmed copilot own conversation", `http=${res.status}`);
    else fail("Ahmed copilot own conversation", `http=${res.status}`);
  }
  {
    const since = new Date();
    const { res } = await api("/ai/copilot-suggestions", {
      token: ahmedToken,
      method: "POST",
      body: { conversationId: convB.id },
    });
    if (res.status === 404) pass("Ahmed copilot Sara conversation 404");
    else fail("Ahmed copilot Sara conversation 404", `http=${res.status}`);
    const audit = await waitAudit(
      {
        actorId: ahmed.id,
        entityId: convB.id,
        status: "FAILED",
      },
      since
    );
    if (audit && (audit.metadata || "").includes("access_denied"))
      pass("AI IDOR audited");
    else fail("AI IDOR audited");
  }

  // ---------- FLOW IDOR ----------
  console.log("-- FLOW IDOR --");
  {
    const { res } = await api(`/flows/active/${contactA.id}`, {
      token: ahmedToken,
    });
    if (res.ok) pass("Ahmed active flow own contact");
    else fail("Ahmed active flow own contact", `http=${res.status}`);
  }
  {
    const since = new Date();
    const { res } = await api(`/flows/active/${contactB.id}`, {
      token: ahmedToken,
    });
    if (res.status === 404) pass("Ahmed active flow Sara contact 404");
    else fail("Ahmed active flow Sara contact 404", `http=${res.status}`);
    const audit = await waitAudit(
      {
        actorId: ahmed.id,
        entityId: contactB.id,
        status: "FAILED",
      },
      since
    );
    if (audit && (audit.metadata || "").includes("access_denied"))
      pass("Flow IDOR audited");
    else fail("Flow IDOR audited");
  }
  {
    const { res } = await api("/flows/stop", {
      token: ahmedToken,
      method: "POST",
      body: { contactId: contactB.id },
    });
    if (res.status === 404) pass("Ahmed stop flow Sara contact 404");
    else fail("Ahmed stop flow Sara contact 404", `http=${res.status}`);
  }
  {
    const { res } = await api(`/flows/active/${contactA.id}`, {
      token: adminToken,
    });
    if (res.ok) pass("Admin active flow any contact");
    else fail("Admin active flow any contact", `http=${res.status}`);
  }

  // ---------- CAMPAIGN SOCKET ----------
  console.log("-- CAMPAIGN SOCKET --");
  {
    const adminSock = await connectSocket(adminToken);
    const agentSock = await connectSocket(ahmedToken);
    if (!adminSock.ok) fail("Admin socket connect", adminSock.reason);
    else pass("Admin socket connect");
    if (!agentSock.ok) fail("Agent socket connect", agentSock.reason);
    else pass("Agent socket connect");

    let adminGot = false;
    let agentGot = false;
    adminSock.socket.on("campaign_progress", () => {
      adminGot = true;
    });
    agentSock.socket.on("campaign_progress", () => {
      agentGot = true;
    });

    let template = await prisma.template.findFirst();
    if (!template) {
      template = await prisma.template.create({
        data: {
          name: `sec-tpl-${Date.now()}`,
          category: "UTILITY",
          language: "ar",
          bodyText: "smoke {{1}}",
          status: "approved",
        },
      });
    }
    let list = await prisma.contactList.findFirst();
    if (!list) {
      list = await prisma.contactList.create({
        data: { name: `sec-list-${Date.now()}` },
      });
    }

    let campaign = await prisma.campaign.create({
      data: {
        name: `sec-smoke-campaign-${Date.now()}`,
        templateId: template.id,
        contactListId: list.id,
        channelId: channel.id,
        status: "sending",
      },
    });

    await api(`/campaigns/${campaign.id}/pause`, {
      token: adminToken,
      method: "POST",
    });
    await sleep(800);
    if (adminGot) pass("Admin receives campaign_progress");
    else fail("Admin receives campaign_progress");
    if (!agentGot) pass("Unauthorized agent does not receive campaign_progress");
    else fail("Unauthorized agent does not receive campaign_progress");

    adminSock.socket.close();
    agentSock.socket.close();
  }

  // ---------- BACKUP ----------
  console.log("-- BACKUP --");
  {
    const result = spawnSync(
      process.execPath,
      ["scripts/backup-db.js", "--json"],
      {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        env: process.env,
      }
    );
    const out = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (result.status === 0) pass("backup succeeds");
    else fail("backup succeeds", out.slice(0, 200));

    if (!/EAA[A-Za-z0-9]{20,}/.test(out) && !/accessToken["']?\s*[:=]\s*["'](?!\[REDACTED\])/.test(out))
      pass("backup output has no plaintext WA token");
    else fail("backup output has no plaintext WA token");

    const backupsDir = path.resolve(__dirname, "..", "backups");
    const jsonFiles = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
      .map((f) => ({
        f,
        t: fs.statSync(path.join(backupsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.t - a.t);
    if (!jsonFiles.length) {
      fail("WhatsAppChannel in backup JSON");
      fail("accessToken redacted in JSON");
      fail("restore structure valid");
    } else {
      const dump = JSON.parse(
        fs.readFileSync(path.join(backupsDir, jsonFiles[0].f), "utf8")
      );
      if (dump.tables?.whatsAppChannels) pass("WhatsAppChannel in backup JSON");
      else fail("WhatsAppChannel in backup JSON");
      const tokens = (dump.tables.whatsAppChannels || []).map(
        (c) => c.accessToken
      );
      if (tokens.every((t) => t === "[REDACTED]" || !t))
        pass("accessToken redacted in JSON");
      else fail("accessToken redacted in JSON");
      if (
        dump.format === "kadina-json-backup-v2" &&
        dump.tables.timelineEvents &&
        dump.tables.flows &&
        dump.tables.flowExecutions &&
        dump.tables.conversations
      )
        pass("restore structure valid");
      else fail("restore structure valid");
    }
  }

  // ---------- IDOR sweep ----------
  console.log("-- IDOR --");
  {
    const since = new Date();
    let campaignRow = await prisma.campaign.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (!campaignRow) {
      let template = await prisma.template.findFirst();
      if (!template) {
        template = await prisma.template.create({
          data: {
            name: `sec-tpl-idor-${Date.now()}`,
            category: "UTILITY",
            language: "ar",
            bodyText: "x",
            status: "approved",
          },
        });
      }
      let list = await prisma.contactList.findFirst();
      if (!list) {
        list = await prisma.contactList.create({
          data: { name: `sec-list-idor-${Date.now()}` },
        });
      }
      campaignRow = await prisma.campaign.create({
        data: {
          name: `sec-idor-campaign-${Date.now()}`,
          templateId: template.id,
          contactListId: list.id,
          channelId: channel.id,
          status: "draft",
        },
      });
    }
    const cases = [
      ["contact", `/contacts/${contactB.id}/profile`, "GET", null],
      [
        "conversation",
        `/conversations/${convB.id}/read`,
        "PATCH",
        null,
      ],
      ["appointment", `/appointments/${apptB.id}`, "GET", null],
      ["note", `/conversations/${convB.id}/notes`, "GET", null],
      ["campaign detail", `/campaigns/${campaignRow.id}`, "GET", null],
      [
        "flow stop foreign",
        "/flows/stop",
        "POST",
        { contactId: contactB.id },
      ],
      [
        "flow active foreign",
        `/flows/active/${contactB.id}`,
        "GET",
        null,
      ],
      ["media unsigned", "/media/does-not-exist.jpg", "GET", null],
    ];

    for (const [name, url, method, body] of cases) {
      if (!url) {
        fail(`IDOR ${name}`, "no fixture");
        continue;
      }
      const { res, data } = await api(url, {
        token: ahmedToken,
        method,
        body: body || undefined,
      });
      const expected =
        name === "campaign detail"
          ? 403
          : name === "media unsigned"
            ? 401
            : 404;
      if (res.status === expected) pass(`IDOR ${name} → ${expected}`);
      else fail(`IDOR ${name} → ${expected}`, `http=${res.status}`);
      const leaked = JSON.stringify(data || "");
      if (
        name !== "media unsigned" &&
        (leaked.includes(contactB.phone) || leaked.includes("secret note"))
      )
        fail(`IDOR ${name} no PII leak`);
    }

    const denied = await waitAudit(
      { actorId: ahmed.id, status: "FAILED" },
      since
    );
    if (denied) pass("IDOR attempts leave AuditLog FAILED rows");
    else fail("IDOR attempts leave AuditLog FAILED rows");
  }

  // Admin still sees both
  {
    const { res } = await api(`/contacts/${contactB.id}/profile`, {
      token: adminToken,
    });
    if (res.ok) pass("Admin still sees Sara contact");
    else fail("Admin still sees Sara contact", `http=${res.status}`);
  }

  // cleanup fixtures (best-effort)
  try {
    await prisma.note.deleteMany({
      where: { id: { in: [noteB.id] } },
    });
    await prisma.appointment.deleteMany({
      where: { id: { in: [apptB.id] } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: [convA.id, convB.id] } },
    });
    await prisma.contact.deleteMany({
      where: { id: { in: [contactA.id, contactB.id] } },
    });
  } catch {
    /* ignore */
  }

  console.log(
    failed
      ? `\n❌ Security P0 smoke FAILED (${failed})\n`
      : "\n✅ Security P0 smoke ALL PASS\n"
  );
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
