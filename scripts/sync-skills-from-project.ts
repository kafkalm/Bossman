/**
 * Sync skills from project .skills/ directory to Bossman.
 * Use after `npx skills add owner/repo` to push installed skills into Bossman.
 *
 * Usage (from the project root that contains .skills/):
 *   npx tsx scripts/sync-skills-from-project.ts
 *   # or from another repo: SKILLS_DIR=/path/to/project/.skills BOSSMAN_URL=http://localhost:3000 npx tsx /path/to/bossman/scripts/sync-skills-from-project.ts
 * Env: BOSSMAN_URL (default http://localhost:3000), SKILLS_DIR (default <cwd>/.skills)
 *
 * Requires: .skills/<skill-name>/SKILL.md (SKILL.md with YAML frontmatter: name, description)
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

const BOSSMAN_URL = process.env.BOSSMAN_URL ?? "http://localhost:3000";
const SKILLS_DIR = process.env.SKILLS_DIR ?? path.join(process.cwd(), ".skills");

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

function collectSkills(dir: string): { name: string; description: string | null; content: string }[] {
  const results: { name: string; description: string | null; content: string }[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(dir, ent.name);
    const skillMd = path.join(skillPath, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    try {
      const raw = fs.readFileSync(skillMd, "utf-8");
      const parsed = parseSkillMd(raw);
      if (parsed.content) results.push(parsed);
    } catch (e) {
      console.warn(`Skip ${skillMd}:`, e);
    }
  }
  return results;
}

async function main() {
  const skills = collectSkills(SKILLS_DIR);
  if (skills.length === 0) {
    console.log("No skills found in", SKILLS_DIR);
    console.log("Run `npx skills add owner/repo` in your project first, then run this script.");
    process.exit(0);
    return;
  }

  const url = `${BOSSMAN_URL.replace(/\/$/, "")}/api/skills/import`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error("Import failed:", err);
    process.exit(1);
  }

  const data = (await res.json()) as { imported: number; updated: number; skills: { name: string; created: boolean }[] };
  console.log(`Synced to Bossman: ${data.imported} new, ${data.updated} updated.`);
  for (const s of data.skills ?? []) {
    console.log(`  - ${s.name} (${s.created ? "new" : "updated"})`);
  }
}

main();
