/**
 * One-time script: sync built-in role system prompts from code to database.
 * This updates the systemPrompt for all built-in roles to match the latest code.
 *
 * Usage: npx tsx scripts/sync-builtin-prompts.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { builtinRoles } from "../src/core/agent/roles/index";

async function main() {
  const prisma = new PrismaClient();

  try {
    for (const role of builtinRoles) {
      const existing = await prisma.agentRole.findUnique({
        where: { name: role.name },
      });

      if (existing) {
        await prisma.agentRole.update({
          where: { name: role.name },
          data: {
            systemPrompt: role.systemPrompt,
          },
        });
        console.log(`✅ Updated systemPrompt for: ${role.title} (${role.name})`);
      } else {
        console.log(`⏭️  Skipped (not in DB): ${role.title} (${role.name})`);
      }
    }

    console.log("\nDone! All built-in role prompts synced.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
