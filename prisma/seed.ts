import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { builtinRoles } from "../src/core/agent/roles";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding built-in agent roles...");

  for (const role of builtinRoles) {
    await prisma.agentRole.upsert({
      where: { name: role.name },
      create: {
        name: role.name,
        title: role.title,
        systemPrompt: role.systemPrompt,
        modelConfig: JSON.stringify(role.defaultModelConfig),
        capabilities: role.capabilities
          ? JSON.stringify(role.capabilities)
          : null,
        isBuiltin: true,
      },
      update: {
        title: role.title,
        systemPrompt: role.systemPrompt,
        modelConfig: JSON.stringify(role.defaultModelConfig),
        capabilities: role.capabilities
          ? JSON.stringify(role.capabilities)
          : null,
      },
    });
    console.log(`  - ${role.title} (${role.name})`);
  }

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
