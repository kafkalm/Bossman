import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { streamLLM, recordTokenUsage } from "@/core/llm";
import type { ChatMessage, MessageContent, ModelConfig } from "@/core/llm/types";

type RouteParams = { params: Promise<{ employeeId: string }> };

// GET: fetch chat history with an employee
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { employeeId } = await params;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { role: true },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const rawMessages = await prisma.directMessage.findMany({
      where: { employeeId },
      orderBy: { createdAt: "asc" },
    });

    // Parse metadata to extract images for each message
    const messages = rawMessages.map((msg) => {
      let images: string[] | undefined;
      if (msg.metadata) {
        try {
          const meta = JSON.parse(msg.metadata);
          if (Array.isArray(meta.images)) images = meta.images;
        } catch { /* ignore */ }
      }
      return {
        id: msg.id,
        employeeId: msg.employeeId,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        images,
      };
    });

    // Parse model config to get modalities
    let modelConfig: Record<string, unknown> = {};
    try { modelConfig = JSON.parse(employee.role.modelConfig); } catch { /* ignore */ }

    return NextResponse.json({
      employee: {
        id: employee.id,
        name: employee.name,
        status: employee.status,
        role: {
          id: employee.role.id,
          name: employee.role.name,
          title: employee.role.title,
        },
        inputModalities: (modelConfig.inputModalities as string[]) ?? ["text"],
        outputModalities: (modelConfig.outputModalities as string[]) ?? ["text"],
      },
      messages,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch chat" },
      { status: 500 }
    );
  }
}

// POST: send a message and get a streaming response
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { employeeId } = await params;
    const body = await request.json();
    const { message, images } = body as { message?: string; images?: string[] };

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Load employee & role
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { role: true },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Save user message, store images in metadata field
    const hasImages = images && images.length > 0;
    const metadata = hasImages ? JSON.stringify({ images }) : undefined;
    await prisma.directMessage.create({
      data: { employeeId, role: "user", content: message, metadata },
    });

    // Build conversation history
    const history = await prisma.directMessage.findMany({
      where: { employeeId },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    const chatMessages: ChatMessage[] = history.map((msg) => {
      // Reconstruct multi-modal content for messages that had images
      if (msg.metadata) {
        try {
          const meta = JSON.parse(msg.metadata);
          if (Array.isArray(meta.images) && meta.images.length > 0) {
            const multipartContent: MessageContent = [
              { type: "text", text: msg.content },
              ...meta.images.map((url: string) => ({ type: "image" as const, url })),
            ];
            return {
              role: msg.role as "user" | "assistant",
              content: multipartContent,
            };
          }
        } catch { /* ignore */ }
      }
      return {
        role: msg.role as "user" | "assistant",
        content: msg.content,
      };
    });

    // Parse model config from role
    const modelConfig: ModelConfig = JSON.parse(employee.role.modelConfig) as ModelConfig;

    // Build system prompt that makes the agent conversational
    const systemPrompt = [
      employee.role.systemPrompt,
      "",
      `你的名字是 ${employee.name}，你在公司担任 ${employee.role.title} 的职位。`,
      "现在你正在和公司的 Founder 进行一对一的对话。",
      "请用自然、专业的方式回应，就像真实的同事对话一样。",
      "你可以谈论你的工作、给出建议、讨论想法，或者单纯地聊天。",
    ].join("\n");

    // Stream response
    const streamResult = streamLLM({
      config: modelConfig,
      messages: chatMessages,
      system: systemPrompt,
    });

    // Collect the full text to save after streaming ends
    const encoder = new TextEncoder();
    let fullText = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamResult.textStream) {
            fullText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();

          // Save assistant message after stream completes
          if (fullText.trim()) {
            await prisma.directMessage.create({
              data: { employeeId, role: "assistant", content: fullText },
            });
          }

          // Record token usage
          try {
            const usage = await streamResult.usage;
            if (usage) {
              await recordTokenUsage(employeeId, null, {
                inputTokens: usage.inputTokens ?? 0,
                outputTokens: usage.outputTokens ?? 0,
                model: modelConfig.model,
                provider: modelConfig.provider,
              });
            }
          } catch {
            // ignore usage recording errors
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat failed" },
      { status: 500 }
    );
  }
}

// DELETE: clear chat history with an employee
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { employeeId } = await params;

    await prisma.directMessage.deleteMany({
      where: { employeeId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear chat" },
      { status: 500 }
    );
  }
}
