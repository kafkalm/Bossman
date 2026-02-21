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

  console.log("Seeding market skills...");
  const marketSkills = [
    {
      name: "code-review",
      description: "Review code for style, bugs and best practices",
      content: `You are a code reviewer. When given code:
- Check for bugs, edge cases and security issues.
- Suggest clearer naming and structure.
- Prefer minimal, readable changes.`,
    },
    {
      name: "doc-writer",
      description: "Write clear docs and README",
      content: `You write documentation. When asked:
- Use clear headings and short paragraphs.
- Include examples where helpful.
- Keep README concise; link to detailed docs.`,
    },
    {
      name: "api-design",
      description: "Design REST/API contracts",
      content: `You design APIs. When designing:
- Use consistent naming and HTTP semantics.
- Document request/response and errors.
- Consider versioning and backward compatibility.`,
    },
  ];
  for (const s of marketSkills) {
    const existing = await prisma.skill.findFirst({
      where: { name: s.name, source: "market", companyId: null },
    });
    if (existing) {
      await prisma.skill.update({
        where: { id: existing.id },
        data: { description: s.description, content: s.content },
      });
    } else {
      await prisma.skill.create({
        data: {
          name: s.name,
          description: s.description,
          content: s.content,
          source: "market",
          companyId: null,
        },
      });
    }
    console.log(`  - ${s.name}`);
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
