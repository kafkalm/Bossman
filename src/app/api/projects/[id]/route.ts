import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { projectManager } from "@/core/project";
import { listWorkspaceFiles, readWorkspaceFile } from "@/core/workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await projectManager.getProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    try {
      const workspaceFiles = await listWorkspaceFiles(id);
      const employeesById = new Map(project.company.employees.map((e) => [e.id, e]));
      const tasksById = new Map(flattenTasks(project.tasks ?? []).map((t) => [t.id, t]));
      const synthesized = await Promise.all(
        workspaceFiles.map(async (wf) => {
          const content = (await readWorkspaceFile(id, wf.relativePath)) ?? "";
          const employee = employeesById.get(wf.employeeId);
          const taskId = extractTaskIDFromPath(wf.pathDir);
          const task = taskId ? tasksById.get(taskId) : null;
          return {
            id: `ws:${wf.relativePath}`,
            projectId: id,
            employeeId: wf.employeeId,
            taskId: task?.id ?? null,
            title: wf.title,
            path: wf.pathDir || null,
            content,
            brief: null,
            fileType: inferFileType(wf.title),
            createdAt: new Date(0).toISOString(),
            employee: employee
              ? {
                  id: employee.id,
                  name: employee.name,
                  role: employee.role,
                }
              : {
                  id: wf.employeeId,
                  name: "Unknown Agent",
                  role: { id: "", name: "unknown", title: "Unknown" },
                },
            task: task ? { id: task.id, title: task.title } : null,
          };
        })
      );
      (project as { files: typeof synthesized }).files = synthesized;
    } catch (error) {
      console.warn("[api/projects/:id] workspace files load failed:", error);
      (project as { files: unknown[] }).files = [];
    }

    let tokenCount = 0;
    try {
      const usages = await prisma.tokenUsage.aggregate({
        where: { projectId: id },
        _sum: { inputTokens: true, outputTokens: true },
      });
      tokenCount = (usages._sum.inputTokens ?? 0) + (usages._sum.outputTokens ?? 0);
    } catch (error) {
      console.warn("[api/projects/:id] tokenUsage aggregate failed:", error);
    }

    return NextResponse.json({ ...project, tokenCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get project" },
      { status: 500 }
    );
  }
}

function flattenTasks(tasks: Array<{ id: string; title: string; subTasks?: unknown[] }>): Array<{ id: string; title: string; subTasks?: unknown[] }> {
  const all: Array<{ id: string; title: string; subTasks?: unknown[] }> = [];
  for (const t of tasks) {
    all.push(t);
    if (Array.isArray(t.subTasks) && t.subTasks.length > 0) {
      all.push(...flattenTasks(t.subTasks as Array<{ id: string; title: string; subTasks?: unknown[] }>));
    }
  }
  return all;
}

function extractTaskIDFromPath(pathDir: string): string | null {
  if (!pathDir) return null;
  const first = pathDir.split("/").filter(Boolean)[0];
  return first || null;
}

function inferFileType(title: string): "code" | "document" {
  const ext = title.split(".").pop()?.toLowerCase() ?? "";
  const codeExt = new Set([
    "ts", "tsx", "js", "jsx", "go", "py", "java", "kt", "rs", "c", "cc", "cpp", "h", "hpp",
    "cs", "php", "rb", "swift", "scala", "sh", "sql", "html", "css", "scss", "json", "yaml", "yml", "toml",
  ]);
  return codeExt.has(ext) ? "code" : "document";
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await projectManager.deleteProject(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete project" },
      { status: 500 }
    );
  }
}
