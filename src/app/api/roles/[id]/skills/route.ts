import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET: list skills attached to this role
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roleId } = await params;
    const role = await prisma.agentRole.findUnique({
      where: { id: roleId },
      include: { skills: { include: { skill: true } } },
    });
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    const skills = role.skills.map((s) => s.skill);
    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get role skills" },
      { status: 500 }
    );
  }
}

// PUT: set skills for this role. Body: { skillIds: string[] }
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roleId } = await params;
    const role = await prisma.agentRole.findUnique({ where: { id: roleId } });
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    const body = await request.json();
    const skillIds = Array.isArray(body.skillIds) ? body.skillIds : [];
    await prisma.agentRoleSkill.deleteMany({ where: { roleId } });
    if (skillIds.length > 0) {
      await prisma.agentRoleSkill.createMany({
        data: skillIds.map((skillId: string) => ({ roleId, skillId })),
      });
    }
    const updated = await prisma.agentRole.findUnique({
      where: { id: roleId },
      include: { skills: { include: { skill: true } } },
    });
    return NextResponse.json({
      skills: updated?.skills.map((s) => s.skill) ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set role skills" },
      { status: 500 }
    );
  }
}
