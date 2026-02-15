import { NextRequest } from "next/server";
import { messageBus } from "@/core/communication/message-bus";

/**
 * SSE endpoint for real-time project updates.
 * Emits "refresh" when new files or deliverables are added.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data?: object) => {
        const chunk = data
          ? `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          : `event: ${event}\ndata: {}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      const unsubscribe = messageBus.subscribe(projectId, (message) => {
        if (
          message.messageType === "deliverable" ||
          message.messageType === "status_update"
        ) {
          send("refresh", { type: message.messageType });
        }
      });

      // Keep-alive ping every 25s
      const keepAlive = setInterval(() => {
        send("ping");
      }, 25000);

      // Cleanup on abort
      request.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          clearInterval(keepAlive);
          controller.close();
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
