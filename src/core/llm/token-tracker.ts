import { prisma } from "@/lib/db";
import type { TokenUsageInfo } from "./types";

/**
 * Records token usage for an employee working on a project.
 */
export async function recordTokenUsage(
  employeeId: string,
  projectId: string | null,
  usage: TokenUsageInfo
) {
  return prisma.tokenUsage.create({
    data: {
      employeeId,
      projectId,
      model: usage.model,
      provider: usage.provider,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost: usage.cost,
    },
  });
}

/**
 * Get aggregated token usage for an employee.
 */
export async function getEmployeeTokenUsage(employeeId: string) {
  const usages = await prisma.tokenUsage.findMany({
    where: { employeeId },
  });

  return {
    totalInputTokens: usages.reduce((sum, u) => sum + u.inputTokens, 0),
    totalOutputTokens: usages.reduce((sum, u) => sum + u.outputTokens, 0),
    totalCost: usages.reduce((sum, u) => sum + (u.cost ?? 0), 0),
    callCount: usages.length,
  };
}

/**
 * Get aggregated token usage for a project.
 */
export async function getProjectTokenUsage(projectId: string) {
  const usages = await prisma.tokenUsage.findMany({
    where: { projectId },
    include: { employee: { include: { role: true } } },
  });

  const byEmployee: Record<
    string,
    {
      employeeId: string;
      employeeName: string;
      roleName: string;
      inputTokens: number;
      outputTokens: number;
      cost: number;
      callCount: number;
    }
  > = {};

  for (const u of usages) {
    const key = u.employeeId;
    if (!byEmployee[key]) {
      byEmployee[key] = {
        employeeId: u.employeeId,
        employeeName: u.employee.name,
        roleName: u.employee.role.title,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        callCount: 0,
      };
    }
    byEmployee[key].inputTokens += u.inputTokens;
    byEmployee[key].outputTokens += u.outputTokens;
    byEmployee[key].cost += u.cost ?? 0;
    byEmployee[key].callCount += 1;
  }

  return {
    total: {
      inputTokens: usages.reduce((sum, u) => sum + u.inputTokens, 0),
      outputTokens: usages.reduce((sum, u) => sum + u.outputTokens, 0),
      cost: usages.reduce((sum, u) => sum + (u.cost ?? 0), 0),
      callCount: usages.length,
    },
    byEmployee: Object.values(byEmployee),
  };
}
