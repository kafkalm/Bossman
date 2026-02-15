import { NextResponse } from "next/server";
import { z } from "zod";
import { projectWorkflow } from "@/core/project";

const MessageSchema = z.object({
  content: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { content } = MessageSchema.parse(body);

    // Send message and get CEO response (async)
    projectWorkflow.founderMessage(id, content).catch((error) => {
      console.error("Founder message error:", error);
    });

    return NextResponse.json({ status: "sent" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message" },
      { status: 400 }
    );
  }
}
