const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const contacts = await prisma.contact.findMany({
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 3 },
      conversation: true,
    },
  });
  console.log(
    JSON.stringify(
      contacts.map((c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        conversationId: c.conversation?.id ?? null,
        messages: c.messages.map((m) => ({
          direction: m.direction,
          content: m.content,
          createdAt: m.createdAt,
        })),
      })),
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
