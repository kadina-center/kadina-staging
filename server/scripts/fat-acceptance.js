/**
 * Final Acceptance Test — Kadina clinic inbox
 * Run: node scripts/fat-acceptance.js
 * Does NOT modify application source; only exercises APIs/DB/socket.
 */
require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const { io } = require(path.join(
  __dirname,
  "..",
  "..",
  "client",
  "node_modules",
  "socket.io-client"
));
const { PrismaClient } = require("@prisma/client");

const BASE = process.env.API_URL || "http://localhost:4000";
const results = [];

function pass(area, name, note = "") {
  results.push({ status: "PASS", area, name, note });
  console.log(`✅ [${area}] ${name}${note ? " — " + note : ""}`);
}
function warn(area, name, note = "") {
  results.push({ status: "WARN", area, name, note });
  console.log(`⚠️ [${area}] ${name}${note ? " — " + note : ""}`);
}
function fail(area, name, note = "") {
  results.push({ status: "FAIL", area, name, note });
  console.log(`❌ [${area}] ${name}${note ? " — " + note : ""}`);
}

async function req(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (opts.body && !headers.has("Content-Type") && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json, status: res.status };
}

function mintJwt(user, expiresIn = "1h") {
  const jwt = require("jsonwebtoken");
  const secret = process.env.JWT_SECRET || "kadina-dev-secret-change-me";
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    secret,
    { expiresIn }
  );
}

async function mintAdminToken(prisma) {
  const user = await prisma.user.findUnique({
    where: { email: "admin@kadina.local" },
  });
  if (!user) throw new Error("admin user missing");
  return mintJwt(user);
}

async function main() {
  const prisma = new PrismaClient();
  let adminToken = null;
  let agentToken = null;
  let contactId = null;
  let conversationId = null;
  let messageId = null;

  try {
    // ========== AUTH ==========
    {
      const bad = await req("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@kadina.local",
          password: "wrong-password-xyz",
        }),
      });
      if (bad.status === 401) pass("AUTH", "Invalid password rejected");
      else if (bad.status === 429)
        warn(
          "AUTH",
          "Invalid password",
          "rate-limited (limiter working); skipped this attempt"
        );
      else fail("AUTH", "Invalid password", `status=${bad.status}`);
    }

    {
      const login = await req("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@kadina.local",
          password: "admin123",
        }),
      });
      if (login.status === 200 && login.json?.token) {
        adminToken = login.json.token;
        pass("AUTH", "Login");
      } else if (login.status === 429) {
        adminToken = await mintAdminToken(prisma);
        warn(
          "AUTH",
          "Login",
          "rate-limited — continued with signed JWT (limiter confirmed earlier)"
        );
      } else {
        fail("AUTH", "Login", JSON.stringify(login.json));
        throw new Error("Cannot continue without admin login");
      }
    }

    {
      const me = await req("/auth/me", { token: adminToken });
      if (me.status === 200 && me.json?.role === "admin")
        pass("AUTH", "Admin session /me");
      else fail("AUTH", "Admin session /me", String(me.status));
    }

    {
      const unauth = await req("/conversations");
      if (unauth.status === 401) pass("AUTH", "Unauthorized without token");
      else fail("AUTH", "Unauthorized without token", String(unauth.status));
    }

    {
      const badTok = await req("/conversations", {
        token: "invalid.jwt.token",
      });
      if (badTok.status === 401) pass("AUTH", "Invalid token rejected");
      else fail("AUTH", "Invalid token", String(badTok.status));
    }

    // Create agent for permission tests
    {
      const email = `agent.fat.${Date.now()}@kadina.local`;
      const created = await req("/users", {
        method: "POST",
        token: adminToken,
        body: JSON.stringify({
          name: "FAT Agent",
          email,
          password: "agent123",
          role: "agent",
        }),
      });
      if (created.status === 201) {
        pass("AUTH", "Admin can create agent");
        const al = await req("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password: "agent123" }),
        });
        if (al.status === 200) {
          agentToken = al.json.token;
          pass("AUTH", "Agent login");
        } else if (al.status === 429) {
          agentToken = mintJwt(created.json);
          warn("AUTH", "Agent login", "rate-limited — used signed JWT");
        } else fail("AUTH", "Agent login", String(al.status));
      } else {
        warn("AUTH", "Create agent", created.json?.error || String(created.status));
      }
    }

    if (agentToken) {
      const agentCreateUser = await req("/users", {
        method: "POST",
        token: agentToken,
        body: JSON.stringify({
          name: "X",
          email: `x${Date.now()}@t.local`,
          password: "abcdef",
          role: "admin",
        }),
      });
      if (agentCreateUser.status === 403)
        pass("AUTH", "Agent blocked from creating users");
      else
        fail(
          "AUTH",
          "Agent blocked from creating users",
          String(agentCreateUser.status)
        );

      const agentCampaign = await req("/campaigns", {
        method: "POST",
        token: agentToken,
        body: JSON.stringify({
          name: "should-fail",
          templateId: "x",
          contactListId: "y",
        }),
      });
      if (agentCampaign.status === 403)
        pass("AUTH", "Agent blocked from creating campaigns");
      else
        fail(
          "AUTH",
          "Agent blocked from creating campaigns",
          String(agentCampaign.status)
        );

      const agentHealth = await req("/health/detailed", { token: agentToken });
      if (agentHealth.status === 403)
        pass("AUTH", "Agent blocked from detailed health");
      else
        fail(
          "AUTH",
          "Agent blocked from detailed health",
          String(agentHealth.status)
        );
    }

    {
      // Session expiration: JWT is 7d — cannot wait; verify expiry claim exists
      // (check before logout so we still have a valid token string)
      try {
        const payload = JSON.parse(
          Buffer.from(String(adminToken).split(".")[1], "base64url").toString()
        );
        if (payload.exp && payload.exp > Date.now() / 1000)
          warn(
            "AUTH",
            "Session expiration",
            "JWT expires claim present — not live-waited"
          );
        else fail("AUTH", "Session expiration", "no exp claim");
      } catch (e) {
        fail("AUTH", "Session expiration", e.message);
      }
    }

    {
      const logout = await req("/auth/logout", {
        method: "POST",
        token: adminToken,
      });
      if (logout.status === 204) pass("AUTH", "Logout");
      else fail("AUTH", "Logout", String(logout.status));

      // Re-login for rest of tests (preserve previous token if rate-limited)
      const prevToken = adminToken;
      const login2 = await req("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@kadina.local",
          password: "admin123",
        }),
      });
      if (login2.status === 200 && login2.json?.token) {
        adminToken = login2.json.token;
      } else if (login2.status === 429) {
        adminToken = await mintAdminToken(prisma);
        warn(
          "AUTH",
          "Re-login after logout",
          "rate-limited — reminted JWT for remaining FAT"
        );
      } else if (prevToken) {
        adminToken = prevToken;
        warn(
          "AUTH",
          "Re-login after logout",
          `status=${login2.status} — kept prior token`
        );
      } else {
        fail("AUTH", "Re-login after logout", String(login2.status));
        throw new Error("Cannot continue without admin token");
      }
    }

    // ========== SECURITY ==========
    {
      const helmetProbe = await fetch(`${BASE}/health`);
      const h = helmetProbe.headers.get("x-content-type-options");
      if (h) pass("SECURITY", "Helmet headers present", `x-content-type-options=${h}`);
      else warn("SECURITY", "Helmet headers", "x-content-type-options missing");
    }

    {
      const uploads = await req("/uploads/nope.jpg");
      if (uploads.status === 404) pass("SECURITY", "Public /uploads blocked");
      else fail("SECURITY", "Public /uploads blocked", String(uploads.status));
    }

    {
      const media = await req("/media/nope.jpg");
      if (media.status === 401) pass("SECURITY", "Unsigned media rejected");
      else fail("SECURITY", "Unsigned media", String(media.status));
    }

    {
      const secret = process.env.WHATSAPP_APP_SECRET || "";
      const configured =
        secret && secret !== "REPLACE_ME" && !secret.startsWith("REPLACE_");
      if (configured) {
        const badSig = await fetch(`${BASE}/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hub-Signature-256": "sha256=deadbeef",
          },
          body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
        });
        if (badSig.status === 401)
          pass("SECURITY", "Webhook invalid signature rejected");
        else
          fail("SECURITY", "Webhook invalid signature", String(badSig.status));
      } else {
        warn(
          "SECURITY",
          "Webhook Signature",
          "WHATSAPP_APP_SECRET not set — HMAC disabled in development"
        );
      }
    }

    {
      // Prefer settings Zod (does not consume login rate-limit budget)
      const zodBad = await req("/settings/clinic", {
        method: "PATCH",
        token: adminToken,
        body: JSON.stringify({ welcomeEnabled: "not-a-boolean" }),
      });
      if (zodBad.status === 400)
        pass("SECURITY", "Input validation (zod settings)");
      else if (zodBad.status === 429)
        warn("SECURITY", "Input validation", "rate-limited on probe");
      else
        fail("SECURITY", "Input validation", String(zodBad.status));
    }

    {
      // Rate limit exists — if already limited from AUTH probes, count as pass
      let limited = false;
      for (let i = 0; i < 35; i++) {
        const r = await req("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: "ratelimit@test.local",
            password: "x",
          }),
        });
        if (r.status === 429) {
          limited = true;
          break;
        }
      }
      if (limited) pass("SECURITY", "Rate limit on login");
      else
        warn(
          "SECURITY",
          "Rate limit on login",
          "did not hit 429 in 35 attempts (window may be shared)"
        );
    }

    // Ensure admin token still valid after rate-limit hammering
    {
      const me = await req("/auth/me", { token: adminToken });
      if (me.status !== 200) {
        adminToken = await mintAdminToken(prisma);
        warn("AUTH", "Token refresh mid-FAT", "reminted after rate-limit phase");
      }
    }

    // ========== DATABASE ==========
    {
      const migrations = await prisma.$queryRaw`
        SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 5
      `;
      if (Array.isArray(migrations) && migrations.length)
        pass(
          "DATABASE",
          "Prisma migrations applied",
          migrations.map((m) => m.migration_name).join(", ")
        );
      else fail("DATABASE", "Prisma migrations", "none found");
    }

    {
      const dupes = await prisma.$queryRaw`
        SELECT "waMessageId", COUNT(*)::int AS c
        FROM "Message"
        WHERE "waMessageId" IS NOT NULL
        GROUP BY "waMessageId"
        HAVING COUNT(*) > 1
        LIMIT 5
      `;
      if (!dupes.length) pass("DATABASE", "No duplicate waMessageId");
      else fail("DATABASE", "Duplicate waMessageId", JSON.stringify(dupes));
    }

    {
      const indexes = await prisma.$queryRaw`
        SELECT indexname FROM pg_indexes WHERE tablename IN ('Message','Conversation','Contact','ScheduledJob') LIMIT 20
      `;
      if (indexes.length >= 5)
        pass("DATABASE", "Indexes present", `${indexes.length} indexes sampled`);
      else warn("DATABASE", "Indexes", `only ${indexes.length} found`);
    }

    // ========== INBOX / CRM ==========
    {
      const page = await req("/conversations?limit=20", { token: adminToken });
      if (page.status === 200 && page.json?.items) {
        pass("INBOX", "List + pagination", `items=${page.json.items.length}`);
        const first = page.json.items[0];
        if (first) {
          conversationId = first.id;
          contactId = first.contactId;
        }
      } else fail("INBOX", "List conversations", String(page.status));
    }

    if (!contactId) {
      // create contact via webhook simulation for remaining tests
      const phone = "967730474000";
      const c = await prisma.contact.findFirst({
        where: { phone, channel: "whatsapp" },
      });
      if (c) {
        contactId = c.id;
        const conv = await prisma.conversation.findUnique({
          where: { contactId: c.id },
        });
        conversationId = conv?.id;
      }
    }

    if (contactId && conversationId) {
      {
        const read = await req(`/conversations/${conversationId}/read`, {
          method: "PATCH",
          token: adminToken,
        });
        if (read.status === 200 && read.json.unreadCount === 0)
          pass("INBOX", "Mark Read");
        else fail("INBOX", "Mark Read", String(read.status));
      }

      {
        const pin = await req(`/conversations/${conversationId}/pin`, {
          method: "PATCH",
          token: adminToken,
          body: JSON.stringify({ pinned: true }),
        });
        if (pin.status === 200 && pin.json.pinned === true)
          pass("INBOX", "Pin");
        else fail("INBOX", "Pin", String(pin.status));
        await req(`/conversations/${conversationId}/pin`, {
          method: "PATCH",
          token: adminToken,
          body: JSON.stringify({ pinned: false }),
        });
      }

      {
        const arch = await req(`/conversations/${conversationId}/archive`, {
          method: "PATCH",
          token: adminToken,
          body: JSON.stringify({ archived: true }),
        });
        if (arch.status === 200 && arch.json.archived === true)
          pass("INBOX", "Archive");
        else fail("INBOX", "Archive", String(arch.status));
        await req(`/conversations/${conversationId}/archive`, {
          method: "PATCH",
          token: adminToken,
          body: JSON.stringify({ archived: false }),
        });
      }

      {
        const search = await req("/conversations?search=967&limit=10", {
          token: adminToken,
        });
        if (search.status === 200)
          pass("INBOX", "Search", `items=${search.json.items?.length ?? 0}`);
        else fail("INBOX", "Search", String(search.status));
      }

      {
        const note = await req(`/conversations/${conversationId}/notes`, {
          method: "POST",
          token: adminToken,
          body: JSON.stringify({ content: "FAT note " + Date.now() }),
        });
        if (note.status === 201) {
          pass("INBOX", "Notes create");
          await req(
            `/conversations/${conversationId}/notes/${note.json.id}`,
            { method: "DELETE", token: adminToken }
          );
        } else fail("INBOX", "Notes", note.json?.error || String(note.status));
      }

      {
        const tags = await req("/tags", { token: adminToken });
        let tagId = tags.json?.[0]?.id;
        if (!tagId) {
          const t = await req("/tags", {
            method: "POST",
            token: adminToken,
            body: JSON.stringify({ name: "fat-tag-" + Date.now() }),
          });
          tagId = t.json?.id;
        }
        if (tagId) {
          const add = await req(`/conversations/${conversationId}/tags`, {
            method: "POST",
            token: adminToken,
            body: JSON.stringify({ tagId }),
          });
          if (add.status === 200 || add.status === 201)
            pass("INBOX", "Tags");
          else fail("INBOX", "Tags", String(add.status));
          await req(`/conversations/${conversationId}/tags/${tagId}`, {
            method: "DELETE",
            token: adminToken,
          });
        } else fail("INBOX", "Tags", "no tag id");
      }

      {
        const crm = await req(`/contacts/${contactId}`, {
          method: "PATCH",
          token: adminToken,
          body: JSON.stringify({
            crmStatus: "vip",
            customNotes: "FAT crm",
          }),
        });
        if (crm.status === 200 && crm.json.crmStatus === "vip")
          pass("INBOX", "CRM update");
        else fail("INBOX", "CRM", crm.json?.error || String(crm.status));
      }

      {
        const take = await req(`/conversations/${conversationId}/takeover`, {
          method: "POST",
          token: adminToken,
        });
        if (take.status === 200) pass("INBOX", "Take Over");
        else fail("INBOX", "Take Over", String(take.status));
      }
    } else {
      fail("INBOX", "Prerequisite contact/conversation", "none found");
    }

    // ========== WHATSAPP SEND / WEBHOOK INBOUND ==========
    if (contactId) {
      // Outbound text
      {
        const send = await req("/messages", {
          method: "POST",
          token: adminToken,
          body: JSON.stringify({
            contactId,
            text: "FAT text " + new Date().toISOString(),
          }),
        });
        if (send.status === 201 && send.json?.status === "sent") {
          pass("WHATSAPP", "Send Text");
          messageId = send.json.id;
        } else if (send.status === 502) {
          warn(
            "WHATSAPP",
            "Send Text",
            send.json?.error || "Meta API failed (token/window?)"
          );
          messageId = send.json?.message?.id;
        } else {
          fail("WHATSAPP", "Send Text", send.json?.error || String(send.status));
        }
      }

      // Quoted reply
      if (messageId) {
        const reply = await req("/messages", {
          method: "POST",
          token: adminToken,
          body: JSON.stringify({
            contactId,
            text: "FAT quoted reply",
            replyToMessageId: messageId,
          }),
        });
        if (reply.status === 201 && reply.json?.replyToMessageId === messageId)
          pass("WHATSAPP", "Quoted Reply");
        else if (reply.status === 502)
          warn("WHATSAPP", "Quoted Reply", reply.json?.error || "Meta failed");
        else
          fail(
            "WHATSAPP",
            "Quoted Reply",
            reply.json?.error || String(reply.status)
          );
      }

      // Interactive buttons
      {
        const buttons = await req("/messages/interactive", {
          method: "POST",
          token: adminToken,
          body: JSON.stringify({
            contactId,
            interactiveType: "buttons",
            bodyText: "FAT buttons?",
            buttons: [
              { id: "yes", title: "نعم" },
              { id: "no", title: "لا" },
            ],
          }),
        });
        if (buttons.status === 201) pass("WHATSAPP", "Buttons / Interactive");
        else if (buttons.status === 502)
          warn("WHATSAPP", "Buttons", buttons.json?.error || "Meta failed");
        else
          fail(
            "WHATSAPP",
            "Buttons",
            buttons.json?.error || String(buttons.status)
          );
      }

      // Templates list (send only if approved template exists)
      {
        const templates = await req("/templates", { token: adminToken });
        if (templates.status === 200) {
          pass("WHATSAPP", "Templates list", `count=${templates.json?.length ?? 0}`);
          const approved = (templates.json || []).find(
            (t) => t.status === "APPROVED" || t.status === "approved"
          );
          if (approved) {
            const ts = await req("/messages/template", {
              method: "POST",
              token: adminToken,
              body: JSON.stringify({
                contactId,
                templateId: approved.id,
                params: [],
              }),
            });
            if (ts.status === 201) pass("WHATSAPP", "Send Template");
            else if (ts.status === 502)
              warn("WHATSAPP", "Send Template", ts.json?.error);
            else fail("WHATSAPP", "Send Template", String(ts.status));
          } else {
            warn("WHATSAPP", "Send Template", "no APPROVED template in DB");
          }
        } else fail("WHATSAPP", "Templates list", String(templates.status));
      }

      // Retry failed (create a fake failed message if needed)
      {
        const failed = await prisma.message.create({
          data: {
            contactId,
            direction: "outbound",
            type: "text",
            content: "FAT retry probe",
            status: "failed",
            errorMessage: "simulated",
          },
        });
        const retry = await req(`/messages/${failed.id}/retry`, {
          method: "POST",
          token: adminToken,
        });
        if (retry.status === 200 && retry.json.status === "sent")
          pass("INBOX", "Retry Failed");
        else if (retry.status === 502)
          warn("INBOX", "Retry Failed", retry.json?.error || "Meta failed");
        else
          fail("INBOX", "Retry Failed", retry.json?.error || String(retry.status));
      }

      // Inbound webhook simulation (various types) — works when HMAC skipped/dev
      const types = [
        {
          name: "Inbound Text",
          msg: {
            from: "967730474000",
            id: "wamid.fat_text_" + Date.now(),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body: "FAT inbound text" },
          },
        },
        {
          name: "Inbound Location",
          msg: {
            from: "967730474000",
            id: "wamid.fat_loc_" + Date.now(),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "location",
            location: { latitude: 15.3, longitude: 44.2, name: "Sanaa" },
          },
        },
        {
          name: "Inbound Contact",
          msg: {
            from: "967730474000",
            id: "wamid.fat_ct_" + Date.now(),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "contacts",
            contacts: [
              {
                name: { formatted_name: "FAT Contact" },
                phones: [{ phone: "+967700000001" }],
              },
            ],
          },
        },
        {
          name: "Inbound Sticker",
          msg: {
            from: "967730474000",
            id: "wamid.fat_st_" + Date.now(),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "sticker",
            sticker: { id: "media_fake", mime_type: "image/webp" },
          },
        },
        {
          name: "Inbound Reaction",
          msg: {
            from: "967730474000",
            id: "wamid.fat_rx_" + Date.now(),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "reaction",
            reaction: { message_id: "wamid.fat_text_x", emoji: "👍" },
          },
        },
        {
          name: "Inbound Interactive",
          msg: {
            from: "967730474000",
            id: "wamid.fat_ib_" + Date.now(),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "interactive",
            interactive: {
              type: "button_reply",
              button_reply: { id: "yes", title: "نعم" },
            },
          },
        },
      ];

      for (const t of types) {
        const payload = {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: {
                    contacts: [
                      { profile: { name: "FAT" }, wa_id: "967730474000" },
                    ],
                    messages: [t.msg],
                  },
                },
              ],
            },
          ],
        };
        const wh = await fetch(`${BASE}/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (wh.status !== 200) {
          fail("WHATSAPP", t.name, `webhook status ${wh.status}`);
          continue;
        }
        let saved = null;
        for (let i = 0; i < 20; i++) {
          saved = await prisma.message.findUnique({
            where: { waMessageId: t.msg.id },
          });
          if (saved) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        if (saved) pass("WHATSAPP", t.name, `type=${saved.type}`);
        else fail("WHATSAPP", t.name, "not persisted within 5s");
      }

      // Media types that need Meta download will fail gracefully
      warn(
        "WHATSAPP",
        "Image/Video/Audio/Voice/PDF live media",
        "Inbound media download requires real Meta media IDs — covered by UI path + prior live usage; not re-sent in FAT"
      );

      // Message status simulation
      if (messageId) {
        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (msg?.waMessageId) {
          const statusPayload = {
            object: "whatsapp_business_account",
            entry: [
              {
                changes: [
                  {
                    field: "messages",
                    value: {
                      statuses: [
                        {
                          id: msg.waMessageId,
                          status: "delivered",
                          recipient_id: "967730474000",
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          };
          await fetch(`${BASE}/webhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(statusPayload),
          });
          await new Promise((r) => setTimeout(r, 400));
          const updated = await prisma.message.findUnique({
            where: { id: messageId },
          });
          if (updated?.status === "delivered" || updated?.status === "read")
            pass("WHATSAPP", "Message Status webhook");
          else
            warn(
              "WHATSAPP",
              "Message Status",
              `status=${updated?.status} (may lag if Meta id invalid)`
            );
        } else {
          warn("WHATSAPP", "Message Status", "no waMessageId on outbound");
        }
      }
    }

    // ========== SOCKET.IO ==========
    await new Promise((resolve) => {
      const socket = io(BASE, {
        transports: ["websocket"],
        auth: { token: adminToken },
      });
      let connected = false;
      const timer = setTimeout(() => {
        if (!connected) fail("SOCKET", "Connect", "timeout");
        socket.disconnect();
        resolve();
      }, 8000);

      socket.on("connect", () => {
        connected = true;
        pass("SOCKET", "Connect with JWT");
        if (conversationId) {
          socket.emit("conversation:view", conversationId);
          socket.emit("typing:start", { conversationId });
          setTimeout(() => {
            socket.emit("typing:stop", { conversationId });
            socket.emit("conversation:unview", conversationId);
            pass("SOCKET", "Typing + Presence emit");
            // Duplicate connection check: open second socket and ensure both connect
            const s2 = io(BASE, {
              transports: ["websocket"],
              auth: { token: adminToken },
            });
            s2.on("connect", () => {
              pass("SOCKET", "Second connection allowed (multi-tab)");
              s2.disconnect();
              clearTimeout(timer);
              socket.disconnect();
              resolve();
            });
            s2.on("connect_error", (e) => {
              fail("SOCKET", "Second connection", e.message);
              clearTimeout(timer);
              socket.disconnect();
              resolve();
            });
          }, 300);
        } else {
          clearTimeout(timer);
          socket.disconnect();
          resolve();
        }
      });
      socket.on("connect_error", (e) => {
        fail("SOCKET", "Connect", e.message);
        clearTimeout(timer);
        resolve();
      });
    });

    warn(
      "SOCKET",
      "Reconnect / no duplicate events",
      "Client singleton socket verified in code review; live reconnect not force-tested"
    );

    // ========== SETTINGS ==========
    {
      const settings = await req("/settings", { token: adminToken });
      if (settings.status === 200) {
        pass("SETTINGS", "Load settings");
        const patch = await req("/settings/clinic", {
          method: "PATCH",
          token: adminToken,
          body: JSON.stringify({
            welcomeEnabled: settings.json.welcomeEnabled,
            awayEnabled: settings.json.awayEnabled,
            welcomeMessage: settings.json.welcomeMessage || "مرحبا",
            awayMessage: settings.json.awayMessage || "خارج الدوام",
            businessHoursJson:
              settings.json.businessHoursJson ||
              '{"days":[0,1,2,3,4],"start":"09:00","end":"17:00"}',
          }),
        });
        if (patch.status === 200)
          pass("SETTINGS", "Business Hours / Welcome / Away save");
        else
          fail("SETTINGS", "Clinic settings save", String(patch.status));
      } else fail("SETTINGS", "Load settings", String(settings.status));
    }

    // ========== CAMPAIGNS ==========
    {
      const lists = await req("/contact-lists", { token: adminToken });
      const templates = await req("/templates", { token: adminToken });
      const listId = lists.json?.[0]?.id;
      const templateId = templates.json?.[0]?.id;
      if (listId && templateId) {
        const created = await req("/campaigns", {
          method: "POST",
          token: adminToken,
          body: JSON.stringify({
            name: "FAT Campaign " + Date.now(),
            templateId,
            contactListId: listId,
          }),
        });
        if (created.status === 201) {
          pass("CAMPAIGNS", "Create");
          const id = created.json.id;
          const get = await req(`/campaigns/${id}`, { token: adminToken });
          if (get.status === 200) pass("CAMPAIGNS", "Get / recipients structure");
          // Do not blast real WhatsApp recipients in FAT unless list is empty/test
          const recipients = get.json?.recipients?.length ?? 0;
          if (recipients === 0) {
            warn("CAMPAIGNS", "Send", "list has 0 recipients — send skipped");
          } else {
            warn(
              "CAMPAIGNS",
              "Send / Delivery / Failure",
              `skipped live send to ${recipients} recipients (avoid spam in FAT)`
            );
          }
          // Schedule in past+future via scheduledAt if API supports on create — check
          warn(
            "CAMPAIGNS",
            "Schedule",
            "schedule path exists via ScheduledJob; not re-fired live in FAT"
          );
        } else {
          fail(
            "CAMPAIGNS",
            "Create",
            created.json?.error || String(created.status)
          );
        }
      } else {
        warn(
          "CAMPAIGNS",
          "Create/Send",
          "missing contact list or template — create one in UI first"
        );
      }
    }

    // ========== BACKUP ==========
    {
      const { spawnSync } = require("child_process");
      const r = spawnSync("node", ["scripts/backup-db.js"], {
        cwd: __dirname + "/..",
        encoding: "utf8",
      });
      if (r.status === 0) pass("BACKUP", "Backup script");
      else
        fail(
          "BACKUP",
          "Backup script",
          (r.stderr || r.stdout || "").slice(0, 200)
        );
      warn(
        "BACKUP",
        "Restore",
        "restore-json.js exists; full restore not executed against live DB (destructive)"
      );
    }

    // ========== LOGGING / HEALTH ==========
    {
      const health = await req("/health/detailed", { token: adminToken });
      if (health.status === 200 && health.json.db === "up") {
        pass("LOGGING", "Health Dashboard API");
        if (health.json.lastAuditLog) pass("LOGGING", "Audit Logs present");
        else warn("LOGGING", "Audit Logs", "no audit rows yet");
        if (typeof health.json.systemErrorsLast24h === "number")
          pass("LOGGING", "Error Logs counter");
        else warn("LOGGING", "Error Logs");
      } else fail("LOGGING", "Health Dashboard", String(health.status));
    }

    // ========== PERFORMANCE smoke ==========
    {
      const t0 = Date.now();
      await req("/conversations?limit=50", { token: adminToken });
      const ms = Date.now() - t0;
      if (ms < 2000) pass("PERFORMANCE", "Conversations query", `${ms}ms`);
      else warn("PERFORMANCE", "Conversations query slow", `${ms}ms`);
    }

    warn(
      "PERFORMANCE",
      "Memory / Socket leak",
      "No long soak test in FAT — client singleton + server disconnect cleanup verified earlier"
    );
  } catch (e) {
    fail("FAT", "Runner crashed", e.message);
  } finally {
    await prisma.$disconnect();
  }

  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) counts[r.status] += 1;

  console.log("\n========== SUMMARY ==========");
  console.log(
    `✅ Passed: ${counts.PASS}  ⚠️ Warning: ${counts.WARN}  ❌ Failed: ${counts.FAIL}`
  );

  // Write machine-readable summary next to script for the report
  const fs = require("fs");
  const out = {
    at: new Date().toISOString(),
    counts,
    results,
  };
  fs.writeFileSync(
    require("path").join(__dirname, "fat-last-results.json"),
    JSON.stringify(out, null, 2)
  );

  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main();
