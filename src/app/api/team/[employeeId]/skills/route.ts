import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { companyManager } from "@/core/company";

// GET: list skill IDs attached to this employee
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  try {
    const companyId = await companyManager.getCompanyId();
    if (!companyId) {
      return NextResponse.json({ error: "No company" }, { status: 400 });
    }
    const { employeeId } = await params;
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: { skills: { include: { skill: true } } },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const skills = employee.skills.map((s) => s.skill);
    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get employee skills" },
      { status: 500 }
    );
  }
}

// PUT: set skills for this employee. Body: { skillIds: string[] }
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  try {
    const companyId = await companyManager.getCompanyId();
    if (!companyId) {
      return NextResponse.json({ error: "No company" }, { status: 400 });
    }
    const { employeeId } = await params;
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const body = await request.json();
    const skillIds = Array.isArray(body.skillIds) ? body.skillIds : [];
    await prisma.employeeSkill.deleteMany({ where: { employeeId } });
    if (skillIds.length > 0) {
      await prisma.employeeSkill.createMany({
        data: skillIds.map((skillId: string) => ({ employeeId, skillId })),
      });
    }
    const updated = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { skills: { include: { skill: true } } },
    });
    return NextResponse.json({
      skills: updated?.skills.map((s) => s.skill) ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set employee skills" },
      { status: 500 }
    );
  }
}
