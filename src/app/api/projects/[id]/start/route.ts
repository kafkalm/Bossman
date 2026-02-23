import { NextResponse } from "next/server";

const GO_ENGINE_URL = process.env.GO_ENGINE_URL ?? "http://localhost:8080";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await fetch(`${GO_ENGINE_URL}/engine/projects/${id}/start`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(body, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start project" },
      { status: 500 }
    );
  }
}
