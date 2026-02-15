import { prisma } from "@/lib/db";
import { agentRegistry } from "@/core/agent/registry";
import type { CreateCompanyInput, HireEmployeeInput } from "./types";

/**
 * CompanyManager handles the single company and its employees.
 * Bossman only supports one company at a time.
 */
export class CompanyManager {
  /**
   * Get the single company. Returns null if not yet created.
   * Also ensures all built-in roles have employees (auto-hires missing ones).
   */
  async getCompany() {
    const company = await prisma.company.findFirst({
      include: {
        employees: { include: { role: true }, orderBy: { createdAt: "asc" } },
        projects: { orderBy: { updatedAt: "desc" } },
      },
    });

    if (company) {
      await this.ensureBuiltinEmployees(company.id);
      // Re-fetch to include any newly created employees
      return prisma.company.findFirst({
        include: {
          employees: { include: { role: true }, orderBy: { createdAt: "asc" } },
          projects: { orderBy: { updatedAt: "desc" } },
        },
      });
    }

    return company;
  }

  /**
   * Get company ID (quick helper). Returns null if not created.
   */
  async getCompanyId(): Promise<string | null> {
    const company = await prisma.company.findFirst({ select: { id: true } });
    return company?.id ?? null;
  }

  /**
   * Initialize the company with a name and default team.
   * Only works if no company exists yet.
   */
  async initCompany(input: CreateCompanyInput) {
    // Check if already exists
    const existing = await prisma.company.findFirst();
    if (existing) {
      throw new Error("Company already exists. Only one company is supported.");
    }

    // Ensure roles are synced to DB
    await agentRegistry.syncToDatabase();

    const company = await prisma.company.create({
      data: {
        name: input.name,
        description: input.description,
      },
    });

    // Get all built-in roles from DB
    const roles = await prisma.agentRole.findMany({
      where: { isBuiltin: true },
    });

    // Hire one agent for each role
    const roleNameMap: Record<string, string> = {
      ceo: "Alex",
      "product-manager": "Jordan",
      "ui-designer": "Morgan",
      "frontend-dev": "Taylor",
      "backend-dev": "Casey",
      "qa-engineer": "Riley",
      researcher: "Quinn",
      "creative-director": "Jamie",
    };

    for (const role of roles) {
      await prisma.employee.create({
        data: {
          companyId: company.id,
          roleId: role.id,
          name: roleNameMap[role.name] ?? role.title,
        },
      });
    }

    return prisma.company.findUniqueOrThrow({
      where: { id: company.id },
      include: {
        employees: { include: { role: true } },
      },
    });
  }

  /**
   * Ensure all built-in roles have at least one employee in the company.
   * Auto-hires missing agents with default names.
   */
  private async ensureBuiltinEmployees(companyId: string) {
    await agentRegistry.syncToDatabase();

    const builtinRoles = await prisma.agentRole.findMany({
      where: { isBuiltin: true },
    });

    const existingEmployees = await prisma.employee.findMany({
      where: { companyId },
      select: { roleId: true },
    });

    const existingRoleIds = new Set(existingEmployees.map((e) => e.roleId));

    const roleNameMap: Record<string, string> = {
      ceo: "Alex",
      "product-manager": "Jordan",
      "ui-designer": "Morgan",
      "frontend-dev": "Taylor",
      "backend-dev": "Casey",
      "qa-engineer": "Riley",
      researcher: "Quinn",
      "creative-director": "Jamie",
    };

    for (const role of builtinRoles) {
      if (!existingRoleIds.has(role.id)) {
        await prisma.employee.create({
          data: {
            companyId,
            roleId: role.id,
            name: roleNameMap[role.name] ?? role.title,
          },
        });
      }
    }
  }

  /**
   * Hire a new employee for the company.
   */
  async hireEmployee(input: HireEmployeeInput) {
    return prisma.employee.create({
      data: {
        companyId: input.companyId,
        roleId: input.roleId,
        name: input.name,
      },
      include: { role: true },
    });
  }
}

export const companyManager = new CompanyManager();
