import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { companyManager } from "@/core/company";
import { syncSkillsFromFs } from "@/core/skills/fs-sync";

const CreateSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.string().min(1),
  source: z.enum(["market", "custom"]).default("custom"),
});

// GET: list skills. Market = .skills/ synced to DB; custom = company. source=market|custom|all
export async function GET(request: Request) {
  try {
    if (!prisma.skill) {
      return NextResponse.json(
        { error: "Database client not ready. Run 'npx prisma generate' and restart the dev server." },
        { status: 503 }
      );
    }
    await syncSkillsFromFs(); // sync .skills/ (or symlink) to DB for display
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") ?? "all";

    const companyId = await companyManager.getCompanyId();

    if (source === "market") {
      const skills = await prisma.skill.findMany({
        where: { source: "market", companyId: null },
        orderBy: { name: "asc" },
      });
      return NextResponse.json(skills);
    }

    if (source === "custom") {
      if (!companyId) return NextResponse.json([]);
      const skills = await prisma.skill.findMany({
        where: { companyId, source: "custom" },
        orderBy: { name: "asc" },
      });
      return NextResponse.json(skills);
    }

    const [market, custom] = await Promise.all([
      prisma.skill.findMany({
        where: { source: "market", companyId: null },
        orderBy: { name: "asc" },
      }),
      companyId
        ? prisma.skill.findMany({
            where: { companyId, source: "custom" },
            orderBy: { name: "asc" },
          })
        : [],
    ]);
    return NextResponse.json([...market, ...custom]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list skills" },
      { status: 500 }
    );
  }
}

// POST: create (upload) a custom skill for the company
export async function POST(request: Request) {
  try {
    if (!prisma.skill) {
      return NextResponse.json(
        { error: "Database client not ready. Run 'npx prisma generate' and restart the dev server." },
        { status: 503 }
      );
    }
    const companyId = await companyManager.getCompanyId();
    if (!companyId) {
      return NextResponse.json(
        { error: "No company found. Create a company first." },
        { status: 400 }
      );
    }
    const body = await request.json();
    const input = CreateSkillSchema.parse(body);
    const skill = await prisma.skill.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        content: input.content,
        source: "custom",
        companyId,
      },
    });
    return NextResponse.json(skill, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = (error as z.ZodError).issues ?? [];
      const msg =
        issues.length > 0
          ? issues.map((e) => `${(e.path || []).join(".") || "body"}: ${e.message}`).join("; ")
          : "Invalid request body";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create skill" },
      { status: 400 }
    );
  }
}
