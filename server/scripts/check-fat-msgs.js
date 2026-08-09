const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.message
  .findMany({
    where: { waMessageId: { startsWith: "wamid.fat_" } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { waMessageId: true, type: true, createdAt: true, content: true },
  })
  .then((rows) => {
    console.log("count", rows.length);
    for (const r of rows) console.log(r.createdAt.toISOString(), r.type, r.waMessageId);
  })
  .finally(() => p.$disconnect());
