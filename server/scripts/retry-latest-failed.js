require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const p = new PrismaClient();
const BASE = process.env.API_URL || "http://localhost:4000";

(async () => {
  const admin = await p.user.findUnique({
    where: { email: "admin@kadina.local" },
  });
  if (!admin) throw new Error("admin missing");
  const secret = process.env.JWT_SECRET || "kadina-dev-secret-change-me";
  const token = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
    secret,
    { expiresIn: "1h" }
  );

  const failed = await p.message.findFirst({
    where: { direction: "outbound", status: "failed" },
    orderBy: { createdAt: "desc" },
  });
  if (!failed) {
    console.log("NO_FAILED");
    await p.$disconnect();
    return;
  }

  console.log("RETRYING", failed.id, (failed.content || "").slice(0, 30));
  const res = await fetch(`${BASE}/messages/${failed.id}/retry`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  console.log("HTTP", res.status, text.slice(0, 300));

  const updated = await p.message.findUnique({
    where: { id: failed.id },
    select: { status: true, errorMessage: true, waMessageId: true },
  });
  console.log("AFTER", updated);
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
