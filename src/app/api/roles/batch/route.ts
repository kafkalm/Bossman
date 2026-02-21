import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const BatchUpdateSchema = z.object({
  roleIds: z.array(z.string().min(1)).min(1).max(100),
  skillIds: z.array(z.string()).optional(),
  /** "add" = merge with existing; "replace" = set to exactly skillIds (default) */
  skillMode: z.enum(["add", "replace"]).optional(),
  modelConfig: z
    .object({
      provider: z.enum([
        "openai",
        "anthropic",
        "google",
        "openrouter",
        "deepseek",
      ]),
      model: z.string(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().optional(),
      inputModalities: z.array(z.string()).optional(),
      outputModalities: z.array(z.string()).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = BatchUpdateSchema.parse(body);

    const existing = await prisma.agentRole.findMany({
      where: { id: { in: input.roleIds } },
      select: { id: true },
    });
    const foundIds = new Set(existing.map((r) => r.id));
    const missing = input.roleIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "Some roles not found", missing },
        { status: 404 }
      );
    }

    for (const roleId of input.roleIds) {
      if (input.modelConfig !== undefined) {
        await prisma.agentRole.update({
          where: { id: roleId },
          data: { modelConfig: JSON.stringify(input.modelConfig) },
        });
      }
      if (input.skillIds !== undefined) {
        const mode = input.skillMode ?? "replace";
        let finalSkillIds = input.skillIds;
        if (mode === "add" && input.skillIds.length > 0) {
          const existing = await prisma.agentRoleSkill.findMany({
            where: { roleId },
            select: { skillId: true },
          });
          const existingSet = new Set(existing.map((e) => e.skillId));
          const toAdd = input.skillIds.filter((id) => !existingSet.has(id));
          finalSkillIds = [...existing.map((e) => e.skillId), ...toAdd];
        }
        await prisma.agentRoleSkill.deleteMany({ where: { roleId } });
        if (finalSkillIds.length > 0) {
          await prisma.agentRoleSkill.createMany({
            data: finalSkillIds.map((skillId) => ({ roleId, skillId })),
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      updated: input.roleIds.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Batch update failed",
      },
      { status: 400 }
    );
  }
}
