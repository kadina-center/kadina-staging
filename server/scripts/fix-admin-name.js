const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.user.updateMany({
    where: { email: "admin@wati.local" },
    data: { name: "Admin" },
  });

  const tagCount = await prisma.tag.count();
  if (tagCount === 0) {
    await prisma.tag.createMany({
      data: [
        { name: "مهم", color: "#EF4444" },
        { name: "متابعة", color: "#3B82F6" },
        { name: "مبيعات", color: "#10B981" },
      ],
    });
    console.log("SEED_TAGS");
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
  });
  console.log("USERS", JSON.stringify(users, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
