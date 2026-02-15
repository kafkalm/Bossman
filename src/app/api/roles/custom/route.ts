import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const CreateRoleSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  systemPrompt: z.string().min(10),
  modelConfig: z.object({
    provider: z.enum(["openai", "anthropic", "google", "openrouter", "deepseek"]),
    model: z.string(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().optional(),
  }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = CreateRoleSchema.parse(body);

    // Check if role name already exists
    const existing = await prisma.agentRole.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Role with name "${input.name}" already exists` },
        { status: 409 }
      );
    }

    const role = await prisma.agentRole.create({
      data: {
        name: input.name,
        title: input.title,
        systemPrompt: input.systemPrompt,
        modelConfig: JSON.stringify(input.modelConfig),
        isBuiltin: false,
      },
    });

    return NextResponse.json(role, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create role" },
      { status: 400 }
    );
  }
}
