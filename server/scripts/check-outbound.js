require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const msgs = await p.message.findMany({
    where: { direction: "outbound" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      content: true,
      status: true,
      errorMessage: true,
      waMessageId: true,
      createdAt: true,
      contactId: true,
      type: true,
    },
  });
  const contacts = await p.contact.findMany({
    where: { id: { in: msgs.map((m) => m.contactId) } },
    select: { id: true, phone: true, name: true },
  });
  const map = Object.fromEntries(contacts.map((c) => [c.id, c]));
  for (const m of msgs) {
    const c = map[m.contactId];
    console.log(
      [
        m.createdAt.toISOString(),
        m.status,
        c?.phone || "?",
        (m.content || "").slice(0, 40).replace(/\n/g, " "),
        m.errorMessage ? `ERR=${m.errorMessage.slice(0, 180)}` : "",
        m.waMessageId ? `wa=${m.waMessageId}` : "wa=null",
      ].join(" | ")
    );
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
