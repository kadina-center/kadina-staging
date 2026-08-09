const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const contact = await prisma.contact.findFirst({
    where: { phone: "967730474000" },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!contact) {
    console.log("CONTACT_NOT_FOUND");
    return;
  }
  console.log(
    JSON.stringify(
      {
        name: contact.name,
        phone: contact.phone,
        count: contact.messages.length,
        messages: contact.messages.map((m) => ({
          direction: m.direction,
          content: m.content,
          status: m.status,
          waMessageId: m.waMessageId,
          createdAt: m.createdAt,
        })),
      },
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
