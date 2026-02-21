import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getSkillsRoot } from "@/core/skills/fs-sync";

const ALLOWED_PREFIX = "npx skills add ";

// POST: run "npx -y skills add <package>" in project root; installs into .agents/skills (or symlink)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const raw = typeof body?.command === "string" ? body.command.trim() : "";
    if (!raw.toLowerCase().startsWith(ALLOWED_PREFIX.toLowerCase())) {
      return NextResponse.json(
        { error: `Only "${ALLOWED_PREFIX}<package>" is allowed. Example: npx skills add owner/repo` },
        { status: 400 }
      );
    }
    const pkg = raw.slice(ALLOWED_PREFIX.length).trim();
    if (!pkg) {
      return NextResponse.json(
        { error: "Missing package. Example: npx skills add skillsmd/skills.md" },
        { status: 400 }
      );
    }

    const cwd = getSkillsRoot();
    // 必须指定 -a cursor，否则 CLI 默认写入 ./skills/ 而非 .agents/skills/
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      const child = spawn("npx", ["-y", "skills", "add", pkg, "-a", "cursor", "-y"], {
        cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => { stdout += d.toString(); });
      child.stderr?.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (code) => resolve({ stdout, stderr, code: code ?? null }));
      child.on("error", (err) => resolve({ stdout, stderr, code: 1 }));
    });

    if (result.code !== 0) {
      return NextResponse.json(
        { error: "Install failed", stdout: result.stdout, stderr: result.stderr },
        { status: 422 }
      );
    }
    return NextResponse.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run install" },
      { status: 500 }
    );
  }
}
