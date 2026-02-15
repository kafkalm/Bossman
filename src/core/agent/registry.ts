import { prisma } from "@/lib/db";
import type { AgentRoleDefinition } from "./types";
import { builtinRoles } from "./roles";

/**
 * AgentRegistry manages agent role templates.
 * Built-in roles are seeded to the database only if they don't exist yet.
 * User modifications in the database are always preserved.
 */
export class AgentRegistry {
  private synced = false;

  /**
   * Get a role definition by name from the database.
   */
  async getRole(name: string): Promise<AgentRoleDefinition | undefined> {
    const dbRole = await prisma.agentRole.findUnique({ where: { name } });
    if (!dbRole) return undefined;
    return {
      name: dbRole.name,
      title: dbRole.title,
      systemPrompt: dbRole.systemPrompt,
      defaultModelConfig: JSON.parse(dbRole.modelConfig),
      capabilities: dbRole.capabilities
        ? JSON.parse(dbRole.capabilities)
        : undefined,
    };
  }

  /**
   * Get all roles from the database.
   */
  async getAllRoles(): Promise<AgentRoleDefinition[]> {
    const dbRoles = await prisma.agentRole.findMany({
      orderBy: { name: "asc" },
    });
    return dbRoles.map((r) => ({
      name: r.name,
      title: r.title,
      systemPrompt: r.systemPrompt,
      defaultModelConfig: JSON.parse(r.modelConfig),
      capabilities: r.capabilities ? JSON.parse(r.capabilities) : undefined,
    }));
  }

  /**
   * Sync built-in roles to the database.
   * Only CREATES roles that don't exist yet — never overwrites user edits.
   */
  async syncToDatabase() {
    if (this.synced) return;

    for (const role of builtinRoles) {
      const existing = await prisma.agentRole.findUnique({
        where: { name: role.name },
      });
      if (!existing) {
        await prisma.agentRole.create({
          data: {
            name: role.name,
            title: role.title,
            systemPrompt: role.systemPrompt,
            modelConfig: JSON.stringify(role.defaultModelConfig),
            capabilities: role.capabilities
              ? JSON.stringify(role.capabilities)
              : null,
            isBuiltin: true,
          },
        });
      }
    }

    this.synced = true;
  }
}

// Singleton instance
export const agentRegistry = new AgentRegistry();
