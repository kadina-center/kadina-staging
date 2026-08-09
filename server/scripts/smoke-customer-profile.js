/**
 * Smoke: Customer Profile / CRM 360
 * node scripts/smoke-customer-profile.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const BASE = process.env.API_URL || "http://localhost:4000";
const prisma = new PrismaClient();

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
  }
  return u;
}

async function main() {
  let failed = 0;
  const pass = (n, note = "") => console.log("✅", n, note ? "— " + note : "");
  const fail = (n, note = "") => {
    failed++;
    console.log("❌", n, note ? "— " + note : "");
  };

  const admin = await prisma.user.findUnique({
    where: { email: "admin@kadina.local" },
  });
  if (!admin) throw new Error("admin missing");
  const agent = await ensureAgent("profile-agent@kadina.local", "ProfileAgent");
  const adminToken = mint(admin);
  const agentToken = mint(agent);

  const contact = await prisma.contact.findFirst({
    where: { conversation: { isNot: null } },
    include: { conversation: true },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!contact?.conversation) {
    fail("fixture");
    process.exit(1);
  }
  const convId = contact.conversation.id;
  const contactId = contact.id;

  // Unassign then admin profile OK
  await prisma.conversation.update({
    where: { id: convId },
    data: { assignedToId: null, assignedAt: null, assignedByUserId: null },
  });

  {
    const { res, data } = await api(`/contacts/${contactId}/profile`, {
      token: adminToken,
    });
    if (
      res.ok &&
      data.contact?.id === contactId &&
      typeof data.counts?.messages === "number" &&
      data.conversation
    )
      pass("Admin profile", `msgs=${data.counts.messages}`);
    else fail("Admin profile", `http=${res.status}`);
  }

  // Agent unassigned → 404 (anti-enumeration)
  {
    const { res } = await api(`/contacts/${contactId}/profile`, {
      token: agentToken,
    });
    if (res.status === 404) pass("Agent unassigned profile 404");
    else fail("Agent unassigned profile 404", `http=${res.status}`);
  }

  // Assign agent
  await api(`/conversations/${convId}/assign`, {
    token: adminToken,
    method: "PATCH",
    body: { userId: agent.id },
  });

  {
    const { res, data } = await api(`/contacts/${contactId}/profile`, {
      token: agentToken,
    });
    if (res.ok && data.conversation?.assignedToId === agent.id)
      pass("Agent assigned profile OK");
    else fail("Agent assigned profile OK", `http=${res.status}`);
  }

  // CRM update via profile fields
  {
    const { res, data } = await api(`/contacts/${contactId}`, {
      token: adminToken,
      method: "PATCH",
      body: {
        doctor: "Dr Profile",
        treatment: "Whitening",
        leadSource: "smoke",
        visitCount: 3,
      },
    });
    const { data: profile } = await api(`/contacts/${contactId}/profile`, {
      token: adminToken,
    });
    if (
      res.ok &&
      profile.contact?.doctor === "Dr Profile" &&
      profile.contact?.treatment === "Whitening" &&
      profile.counts?.visits === 3
    )
      pass("CRM clinic fields in profile");
    else fail("CRM clinic fields in profile", JSON.stringify(data)?.slice(0, 80));
  }

  // Media endpoint
  {
    const { res, data } = await api(`/contacts/${contactId}/media?limit=10`, {
      token: adminToken,
    });
    if (res.ok && Array.isArray(data.items)) pass("Media gallery", `n=${data.items.length}`);
    else fail("Media gallery", `http=${res.status}`);
  }

  // Appointments list scoped
  {
    const { res, data } = await api(
      `/appointments?contactId=${contactId}&limit=20`,
      { token: adminToken }
    );
    const items = data.items || data;
    if (res.ok && Array.isArray(items)) pass("Appointments list");
    else fail("Appointments list", `http=${res.status}`);
  }

  // Timeline still works
  {
    const { res } = await api(`/contacts/${contactId}/timeline?limit=5`, {
      token: agentToken,
    });
    if (res.ok) pass("Agent timeline OK when assigned");
    else fail("Agent timeline OK when assigned", `http=${res.status}`);
  }

  // Notes OK for agent
  {
    const { res } = await api(`/conversations/${convId}/notes`, {
      token: agentToken,
      method: "POST",
      body: { content: "profile smoke note " + Date.now() },
    });
    if (res.ok || res.status === 201) pass("Agent note OK");
    else fail("Agent note OK", `http=${res.status}`);
  }

  // Unassign → agent loses profile again
  await api(`/conversations/${convId}/assign`, {
    token: adminToken,
    method: "PATCH",
    body: { userId: null },
  });
  {
    const { res } = await api(`/contacts/${contactId}/profile`, {
      token: agentToken,
    });
    if (res.status === 404) pass("Agent loses profile after unassign");
    else fail("Agent loses profile after unassign", `http=${res.status}`);
  }

  // lastAgent: assign admin send path — create outbound as admin via DB+touch or API
  {
    await prisma.conversation.update({
      where: { id: convId },
      data: {
        assignedToId: admin.id,
        assignedAt: new Date(),
        assignedByUserId: admin.id,
      },
    });
    // Prefer API send (may 502) — also set lastAgent via prisma to verify profile field
    await api("/messages", {
      token: adminToken,
      method: "POST",
      body: { contactId, text: "profile lastAgent " + Date.now() },
    });
    await new Promise((r) => setTimeout(r, 400));
    const { data: profile } = await api(`/contacts/${contactId}/profile`, {
      token: adminToken,
    });
    if (profile?.lastRepliedBy || profile?.contact?.lastAgentId)
      pass(
        "Last replied / lastAgent present",
        `lastAgent=${profile.contact?.lastAgentId || "null"} replied=${profile.lastRepliedBy?.name || "null"}`
      );
    else fail("Last replied / lastAgent present");
  }

  await prisma.$disconnect();
  console.log(failed === 0 ? "\nALL PASS" : `\nFAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
