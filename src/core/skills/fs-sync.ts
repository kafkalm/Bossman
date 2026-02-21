/**
 * Sync skills from .agents/skills/ directory (or symlink) to DB.
 * Used so "company skill library" displays from that directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "@/lib/db";

const SKILLS_ROOT = process.env.BOSSMAN_SKILLS_ROOT || process.cwd();
const SKILLS_DIR = path.join(SKILLS_ROOT, ".agents", "skills");

function parseSkillMd(raw: string): { name: string; description: string | null; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  let name = "";
  let description: string | null = null;
  let content = raw;
  if (match) {
    const frontmatter = match[1];
    content = match[2].trim();
    for (const line of frontmatter.split("\n")) {
      const nameMatch = line.match(/^name:\s*["']?(.+?)["']?$/);
      const descMatch = line.match(/^description:\s*["']?([\s\S]*?)["']?$/);
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim() || null;
    }
  }
  if (!name && content) {
    const firstLine = content.split("\n")[0]?.replace(/^#\s*/, "").trim();
    if (firstLine) name = firstLine.slice(0, 64);
  }
  if (!name) name = "unnamed-skill";
  return { name, description, content };
}

export async function syncSkillsFromFs(): Promise<number> {
  if (!prisma.skill) return 0;
  if (!fs.existsSync(SKILLS_DIR)) return 0;

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  let count = 0;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, ent.name);
    const skillMd = path.join(skillPath, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    try {
      const raw = fs.readFileSync(skillMd, "utf-8");
      const { name, description, content } = parseSkillMd(raw);
      const existing = await prisma.skill.findFirst({
        where: { companyId: null, source: "market", name: ent.name },
      });
      if (existing) {
        await prisma.skill.update({
          where: { id: existing.id },
          data: { description, content },
        });
      } else {
        await prisma.skill.create({
          data: {
            name: ent.name,
            description,
            content,
            source: "market",
            companyId: null,
          },
        });
      }
      count++;
    } catch {
      // skip invalid
    }
  }
  return count;
}

export function getSkillsDir(): string {
  return SKILLS_DIR;
}

export function getSkillsRoot(): string {
  return SKILLS_ROOT;
}
