import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const UpdateRoleSchema = z.object({
  title: z.string().min(1).optional(),
  systemPrompt: z.string().min(10).optional(),
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
      temperature: z.number().min(0).max(2).default(0.7),
      maxTokens: z.number().optional(),
    })
    .optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const input = UpdateRoleSchema.parse(body);

    const existing = await prisma.agentRole.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt;
    if (input.modelConfig !== undefined)
      data.modelConfig = JSON.stringify(input.modelConfig);

    const updated = await prisma.agentRole.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update role",
      },
      { status: 400 }
    );
  }
}
