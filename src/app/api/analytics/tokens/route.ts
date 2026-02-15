import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const companyId = searchParams.get("companyId");

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (companyId) {
      where.employee = { companyId };
    }

    const usages = await prisma.tokenUsage.findMany({
      where,
      include: {
        employee: { include: { role: true } },
        project: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Aggregate stats
    const totalInput = usages.reduce((s, u) => s + u.inputTokens, 0);
    const totalOutput = usages.reduce((s, u) => s + u.outputTokens, 0);
    const totalCost = usages.reduce((s, u) => s + (u.cost ?? 0), 0);

    // Group by employee
    const byEmployee: Record<string, {
      name: string;
      role: string;
      inputTokens: number;
      outputTokens: number;
      cost: number;
      calls: number;
    }> = {};

    for (const u of usages) {
      const key = u.employeeId;
      if (!byEmployee[key]) {
        byEmployee[key] = {
          name: u.employee.name,
          role: u.employee.role.title,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          calls: 0,
        };
      }
      byEmployee[key].inputTokens += u.inputTokens;
      byEmployee[key].outputTokens += u.outputTokens;
      byEmployee[key].cost += u.cost ?? 0;
      byEmployee[key].calls += 1;
    }

    return NextResponse.json({
      total: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        totalTokens: totalInput + totalOutput,
        cost: totalCost,
        calls: usages.length,
      },
      byEmployee: Object.values(byEmployee),
      recent: usages.slice(0, 20),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get token analytics" },
      { status: 500 }
    );
  }
}
