import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { projectManager } from "@/core/project";

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
    const usages = await prisma.tokenUsage.aggregate({
      where: { projectId: id },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const tokenCount =
      (usages._sum.inputTokens ?? 0) + (usages._sum.outputTokens ?? 0);
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
