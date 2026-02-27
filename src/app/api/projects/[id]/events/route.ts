import { getGoEngineURL } from "@/lib/go-engine";

// This route is superseded by the next.config.ts rewrite that proxies SSE
// directly to the Go engine at http://localhost:8080/engine/projects/:id/events.
// This file is kept as a fallback reference only and should not be reached
// in normal operation.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fallback: manually stream from Go engine
  const upstream = await fetch(`${getGoEngineURL()}/engine/projects/${id}/events`, {
    headers: { Accept: "text/event-stream" },
  });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
