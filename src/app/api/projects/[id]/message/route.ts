import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { messageBus } from "@/core/communication/message-bus";
import { projectManager } from "@/core/project";

const GO_ENGINE_URL = process.env.GO_ENGINE_URL ?? "http://localhost:8080";

const MessageSchema = z.object({
  content: z.string().min(1),
});

/** Detect if the Founder is accepting/approving the project */
function isFounderAcceptance(content: string): boolean {
  const t = content.trim().toLowerCase();
  return (
    /验收通过|通过验收|通过$|^通过\s|接受|确认完成/.test(content) ||
    /\baccept(ed)?\b|\bapproved?\b/.test(t)
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { content } = MessageSchema.parse(body);

    // 1. Persist founder message to DB so it appears in chat history
    await messageBus.send({
      projectId: id,
      senderType: "founder",
      messageType: "founder_message",
      content,
    });

    // 2. If project is in review and Founder accepts → mark completed
    const project = await prisma.project.findUnique({
      where: { id },
      select: { status: true },
    });

    if (project?.status === "review" && isFounderAcceptance(content)) {
      await projectManager.updateStatus(id, "completed");
      return NextResponse.json({ status: "accepted" });
    }

    // 3. Forward message to Go engine so CEO can respond
    const res = await fetch(`${GO_ENGINE_URL}/engine/projects/${id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return NextResponse.json(errBody, { status: res.status });
    }

    return NextResponse.json({ status: "sent" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message" },
      { status: 400 }
    );
  }
}
