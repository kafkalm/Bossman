import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { companyManager } from "@/core/company";

const ImportSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.string().min(1),
});

const ImportBodySchema = z.object({
  skills: z.array(ImportSkillSchema),
});

// POST: bulk import skills (e.g. from .skills/ or pasted SKILL.md). Upserts by name per company.
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
    const { skills: inputSkills } = ImportBodySchema.parse(body);
    if (inputSkills.length === 0) {
      return NextResponse.json({ imported: 0, updated: 0, skills: [] });
    }

    const results: { id: string; name: string; created: boolean }[] = [];
    for (const s of inputSkills) {
      const name = s.name.trim();
      const content = s.content.trim();
      if (!name || !content) continue;
      const description = s.description?.trim() ?? null;
      const existing = await prisma.skill.findFirst({
        where: { companyId, name, source: "custom" },
      });
      if (existing) {
        await prisma.skill.update({
          where: { id: existing.id },
          data: { description, content },
        });
        results.push({ id: existing.id, name, created: false });
      } else {
        const created = await prisma.skill.create({
          data: { name, description, content, source: "custom", companyId },
        });
        results.push({ id: created.id, name, created: true });
      }
    }

    const imported = results.filter((r) => r.created).length;
    const updated = results.filter((r) => !r.created).length;
    return NextResponse.json({ imported, updated, skills: results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = (error as z.ZodError).issues ?? [];
      const msg =
        issues.length > 0
          ? issues.map((e) => `${(e.path || []).join(".") || "body"}: ${e.message}`).join("; ")
          : "Invalid request body";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import skills" },
      { status: 500 }
    );
  }
}
