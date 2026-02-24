import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { projectManager } from "@/core/project";
import { hydrateProjectFilesContent, listWorkspaceFiles, readWorkspaceFile } from "@/core/workspace";

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
      await hydrateProjectFilesContent(project);
    } catch (error) {
      console.warn("[api/projects/:id] hydrateProjectFilesContent failed:", error);
    }

    // Fallback: if DB-backed project.files is empty (or failed upstream),
    // surface files directly from workspace so UI can still browse outputs.
    if (!project.files || project.files.length === 0) {
      try {
        const workspaceFiles = await listWorkspaceFiles(id);
        if (workspaceFiles.length > 0) {
          const employeesById = new Map(project.company.employees.map((e) => [e.id, e]));
          const synthesized = await Promise.all(
            workspaceFiles.map(async (wf) => {
              const content = (await readWorkspaceFile(id, wf.relativePath)) ?? "";
              const employee = employeesById.get(wf.employeeId);
              return {
                id: `ws:${wf.relativePath}`,
                projectId: id,
                employeeId: wf.employeeId,
                taskId: null,
                title: wf.title,
                path: wf.pathDir || null,
                content,
                brief: null,
                fileType: "document",
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
                task: null,
              };
            })
          );
          (project as { files: typeof synthesized }).files = synthesized;
        }
      } catch (error) {
        console.warn("[api/projects/:id] workspace fallback files failed:", error);
      }
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await projectManager.deleteProject(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete project" },
      { status: 500 }
    );
  }
}
