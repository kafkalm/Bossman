import { NextResponse } from "next/server";
import { projectManager } from "@/core/project";
import { projectWorkflow } from "@/core/project";
import { companyManager } from "@/core/company";
import { z } from "zod";

export async function GET() {
  try {
    const companyId = await companyManager.getCompanyId();
    const projects = await projectManager.listProjects(companyId ?? undefined);
    return NextResponse.json(projects);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list projects" },
      { status: 500 }
    );
  }
}

const CreateProjectBody = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const companyId = await companyManager.getCompanyId();
    if (!companyId) {
      return NextResponse.json(
        { error: "No company found. Please set up your company first." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, description } = CreateProjectBody.parse(body);
    const project = await projectManager.createProject({
      companyId,
      name,
      description: description || "",
    });

    // Auto-trigger CEO project initiation (async, fire-and-forget)
    projectWorkflow.startProject(project.id).catch((error) => {
      console.error("Project initiation error:", error);
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create project" },
      { status: 400 }
    );
  }
}
