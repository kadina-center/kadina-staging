const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.tag.deleteMany({});
  await prisma.tag.createMany({
    data: [
      { name: "Important", color: "#EF4444" },
      { name: "Follow-up", color: "#3B82F6" },
      { name: "Sales", color: "#10B981" },
    ],
  });
  const tags = await prisma.tag.findMany();
  console.log("TAGS", JSON.stringify(tags, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
