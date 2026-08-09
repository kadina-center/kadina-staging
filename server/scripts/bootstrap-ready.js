const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.user.count();
  if (count === 0) {
    const user = await prisma.user.create({
      data: {
        name: "مدير النظام",
        email: "admin@wati.local",
        role: "admin",
      },
    });
    console.log("SEED_USER", user.id, user.email);
  } else {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
    });
    console.log("USERS", JSON.stringify(users, null, 2));
  }

  const settings = await prisma.aiAgentSettings.findFirst();
  if (!settings) {
    await prisma.aiAgentSettings.create({ data: {} });
    console.log("SEED_AI_SETTINGS");
  }

  const contacts = await prisma.contact.count();
  const conversations = await prisma.conversation.count();
  const messages = await prisma.message.count();
  const tags = await prisma.tag.count();
  console.log(
    "COUNTS",
    JSON.stringify({ contacts, conversations, messages, tags })
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
