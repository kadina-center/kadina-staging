/**
 * Smoke: Conversation Assignment & Visibility
 * node scripts/smoke-assignment-visibility.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { io } = require("../../client/node_modules/socket.io-client");

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
  const ahmed = await ensureAgent("ahmed-vis@kadina.local", "Ahmed");
  const sara = await ensureAgent("sara-vis@kadina.local", "Sara");
  const adminToken = mint(admin);
  const ahmedToken = mint(ahmed);
  const saraToken = mint(sara);

  const contact = await prisma.contact.findFirst({
    where: { conversation: { isNot: null } },
    include: { conversation: true },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!contact?.conversation) {
    fail("fixture conversation");
    process.exit(1);
  }
  const convId = contact.conversation.id;

  // Reset unassigned + clear soft-lock so lock steps are deterministic
  await prisma.conversation.update({
    where: { id: convId },
    data: {
      assignedToId: null,
      assignedAt: null,
      assignedByUserId: null,
      lockedById: null,
      lockedAt: null,
    },
  });

  // 1 Admin sees unassigned
  {
    const { res, data } = await api("/conversations?limit=50&assignedToId=null", {
      token: adminToken,
    });
    const items = data.items || data;
    if (res.ok && items.some((c) => c.id === convId)) pass("Admin sees unassigned");
    else fail("Admin sees unassigned", `http=${res.status}`);
  }

  // 2 Agent does NOT see unassigned
  {
    const { res, data } = await api("/conversations?limit=50", {
      token: ahmedToken,
    });
    const items = data.items || data;
    if (res.ok && !items.some((c) => c.id === convId))
      pass("Ahmed inbox hides unassigned");
    else fail("Ahmed inbox hides unassigned", `n=${items?.length}`);
  }

  // 3 Assign → Ahmed
  {
    const { res, data } = await api(`/conversations/${convId}/assign`, {
      token: adminToken,
      method: "PATCH",
      body: { userId: ahmed.id },
    });
    if (res.ok && data.assignedToId === ahmed.id) pass("Assign to Ahmed");
    else fail("Assign to Ahmed", `http=${res.status}`);
  }

  // 4 Ahmed sees it
  {
    const { res, data } = await api("/conversations?limit=50", {
      token: ahmedToken,
    });
    const items = data.items || data;
    if (res.ok && items.some((c) => c.id === convId)) pass("Ahmed sees assigned");
    else fail("Ahmed sees assigned");
  }

  // 5 Sara does not see it
  {
    const { res, data } = await api("/conversations?limit=50", {
      token: saraToken,
    });
    const items = data.items || data;
    if (res.ok && !items.some((c) => c.id === convId))
      pass("Sara inbox empty for this conv");
    else fail("Sara inbox empty for this conv");
  }

  // 6 Sara direct GET messages → 404 (anti-enumeration)
  {
    const { res } = await api(`/contacts/${contact.id}/messages?limit=10`, {
      token: saraToken,
    });
    if (res.status === 404) pass("Sara messages 404");
    else fail("Sara messages 404", `http=${res.status}`);
  }

  // 7 Sara send 404
  {
    const { res } = await api("/messages", {
      token: saraToken,
      method: "POST",
      body: { contactId: contact.id, text: "should fail" },
    });
    if (res.status === 404) pass("Sara send 404");
    else fail("Sara send 404", `http=${res.status}`);
  }

  // 8 Sara timeline 404
  {
    const { res } = await api(`/contacts/${contact.id}/timeline?limit=10`, {
      token: saraToken,
    });
    if (res.status === 404) pass("Sara timeline 404");
    else fail("Sara timeline 404", `http=${res.status}`);
  }

  // 9 Sara note 404
  {
    const { res } = await api(`/conversations/${convId}/notes`, {
      token: saraToken,
      method: "POST",
      body: { content: "nope" },
    });
    if (res.status === 404) pass("Sara note 404");
    else fail("Sara note 404", `http=${res.status}`);
  }

  // 10 Sara CRM update 404
  {
    const { res } = await api(`/contacts/${contact.id}`, {
      token: saraToken,
      method: "PATCH",
      body: { crmStatus: "VIP" },
    });
    if (res.status === 404) pass("Sara CRM 404");
    else fail("Sara CRM 404", `http=${res.status}`);
  }

  // 11 Sara mark read 404
  {
    const { res } = await api(`/conversations/${convId}/read`, {
      token: saraToken,
      method: "PATCH",
    });
    if (res.status === 404) pass("Sara mark read 404");
    else fail("Sara mark read 404", `http=${res.status}`);
  }

  // 12 Sara lock 404
  {
    const { res } = await api(`/conversations/${convId}/lock`, {
      token: saraToken,
      method: "PATCH",
    });
    if (res.status === 404) pass("Sara lock 404");
    else fail("Sara lock 404", `http=${res.status}`);
  }

  // 13 Ahmed send OK (may fail WA but not 403/404 access denial)
  {
    const { res } = await api("/messages", {
      token: ahmedToken,
      method: "POST",
      body: { contactId: contact.id, text: "vis smoke " + Date.now() },
    });
    if (res.status !== 403 && res.status !== 404)
      pass("Ahmed send not forbidden", `http=${res.status}`);
    else fail("Ahmed send not forbidden", `http=${res.status}`);
  }

  // 14 Admin sees messages
  {
    const { res } = await api(`/contacts/${contact.id}/messages?limit=5`, {
      token: adminToken,
    });
    if (res.ok) pass("Admin messages OK");
    else fail("Admin messages OK", `http=${res.status}`);
  }

  // 15 Agent cannot assign
  {
    const { res } = await api(`/conversations/${convId}/assign`, {
      token: ahmedToken,
      method: "PATCH",
      body: { userId: sara.id },
    });
    if (res.status === 403) pass("Agent assign forbidden");
    else fail("Agent assign forbidden", `http=${res.status}`);
  }

  // 16 Reassign Ahmed → Sara
  {
    const { res, data } = await api(`/conversations/${convId}/assign`, {
      token: adminToken,
      method: "PATCH",
      body: { userId: sara.id },
    });
    if (res.ok && data.assignedToId === sara.id) pass("Reassign to Sara");
    else fail("Reassign to Sara", `http=${res.status}`);
  }

  // 17 Ahmed loses access → 404
  {
    const { res } = await api(`/contacts/${contact.id}/messages?limit=5`, {
      token: ahmedToken,
    });
    if (res.status === 404) pass("Ahmed loses access");
    else fail("Ahmed loses access", `http=${res.status}`);
  }

  // 18 Sara gains access
  {
    const { res, data } = await api("/conversations?limit=50", {
      token: saraToken,
    });
    const items = data.items || data;
    if (res.ok && items.some((c) => c.id === convId)) pass("Sara gains access");
    else fail("Sara gains access");
  }

  // 19 Search does not leak to Ahmed
  {
    const q = encodeURIComponent(contact.phone.slice(-4));
    const { res, data } = await api(`/conversations?limit=50&search=${q}`, {
      token: ahmedToken,
    });
    const items = data.items || data;
    if (res.ok && !items.some((c) => c.id === convId))
      pass("Search no leak to Ahmed");
    else fail("Search no leak to Ahmed");
  }

  // 20 Timeline assignment events
  {
    const row = await prisma.timelineEvent.findFirst({
      where: {
        conversationId: convId,
        eventType: { in: ["ASSIGNMENT_CREATED", "ASSIGNMENT_CHANGED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (row) pass("Timeline assignment event", row.eventType);
    else fail("Timeline assignment event");
  }

  // 21 Audit assignment
  {
    const row = await prisma.auditLog.findFirst({
      where: {
        entityId: convId,
        action: { in: ["ASSIGN", "TRANSFER"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (row) pass("Audit assignment", row.action);
    else fail("Audit assignment");
  }

  // 22 Notes for Sara OK
  {
    const { res } = await api(`/conversations/${convId}/notes`, {
      token: saraToken,
      method: "POST",
      body: { content: "sara note " + Date.now() },
    });
    if (res.ok || res.status === 201) pass("Sara note OK");
    else fail("Sara note OK", `http=${res.status}`);
  }

  // 23 Lock Sara OK
  {
    const { res } = await api(`/conversations/${convId}/lock`, {
      token: saraToken,
      method: "PATCH",
    });
    if (res.ok) {
      pass("Sara lock OK");
      await api(`/conversations/${convId}/unlock`, {
        token: saraToken,
        method: "PATCH",
      });
    } else fail("Sara lock OK", `http=${res.status}`);
  }

  // 24 Admin takeover
  {
    const { res, data } = await api(`/conversations/${convId}/takeover`, {
      token: adminToken,
      method: "POST",
    });
    if (res.ok && data.assignedToId === admin.id) pass("Admin takeover");
    else fail("Admin takeover", `http=${res.status}`);
  }

  // 25 Socket: Sara should NOT get message content after admin owns it
  {
    let saraGotContent = false;
    const socket = io(BASE, {
      transports: ["websocket"],
      auth: { token: saraToken },
    });
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 3500);
      socket.on("connect", async () => {
        socket.on("new_message", (payload) => {
          if (payload?.contact?.id === contact.id) {
            if (payload?.message?.content) saraGotContent = true;
          }
        });
        // Admin sends (may fail WA) — if emitted, Sara must not receive
        await api("/messages", {
          token: adminToken,
          method: "POST",
          body: { contactId: contact.id, text: "socket leak test " + Date.now() },
        });
        setTimeout(() => {
          clearTimeout(t);
          resolve();
        }, 1500);
      });
      socket.on("connect_error", () => {
        clearTimeout(t);
        resolve();
      });
    });
    socket.close();
    if (!saraGotContent) pass("Socket no leak to Sara");
    else fail("Socket no leak to Sara", "received new_message");
  }

  // Restore assign to Ahmed for convenience? leave as admin

  await prisma.$disconnect();
  console.log(failed === 0 ? "\nALL PASS" : `\nFAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
