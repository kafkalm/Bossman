import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const companyId = searchParams.get("companyId");
    const summaryOnly = searchParams.get("summaryOnly") === "true";

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (companyId) {
      where.employee = { companyId };
    }

    if (summaryOnly && (companyId || projectId)) {
      const agg = await prisma.tokenUsage.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true },
        _count: true,
      });
      const totalInput = agg._sum.inputTokens ?? 0;
      const totalOutput = agg._sum.outputTokens ?? 0;
      return NextResponse.json({
        total: {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          totalTokens: totalInput + totalOutput,
          cost: 0,
          calls: agg._count,
        },
      });
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

    const byEmployeeList = Object.values(byEmployee).sort(
      (a, b) =>
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
    );

    return NextResponse.json({
      total: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        totalTokens: totalInput + totalOutput,
        cost: totalCost,
        calls: usages.length,
      },
      byEmployee: byEmployeeList,
      recent: usages.slice(0, 20),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get token analytics" },
      { status: 500 }
    );
  }
}
