import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentRegistry } from "@/core/agent";

export async function GET() {
  try {
    // Ensure roles are synced
    await agentRegistry.syncToDatabase();
    const roles = await prisma.agentRole.findMany({
      orderBy: { name: "asc" },
      include: { skills: { include: { skill: { select: { id: true, name: true } } } } },
    });
    return NextResponse.json(roles);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list roles" },
      { status: 500 }
    );
  }
}
