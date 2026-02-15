import { NextResponse } from "next/server";
import { projectWorkflow } from "@/core/project";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Start the project workflow (async - don't await completion)
    projectWorkflow.startProject(id).catch((error) => {
      console.error("Project workflow error:", error);
    });
    return NextResponse.json({ status: "started" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start project" },
      { status: 500 }
    );
  }
}
