import { NextResponse } from "next/server";
import { getGoEngineURL } from "@/lib/go-engine";

function clampLimit(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 30;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(parsed, 100);
}

type TimelineEvent = {
  id: string;
  projectId: string;
  taskId: string | null;
  eventType: string;
  actor: string;
  summary: string;
  payload: string | null;
  createdAt: string;
};

function readField(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj) return obj[key];
  }
  return undefined;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function normalizeEvent(raw: unknown): TimelineEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = asString(readField(obj, "id", "ID"));
  const projectId = asString(readField(obj, "projectId", "ProjectID"));
  const createdAt = asString(readField(obj, "createdAt", "CreatedAt"));
  if (!id || !projectId || !createdAt) return null;

  return {
    id,
    projectId,
    taskId: asNullableString(readField(obj, "taskId", "TaskID")),
    eventType: asString(readField(obj, "eventType", "EventType")),
    actor: asString(readField(obj, "actor", "Actor")),
    summary: asString(readField(obj, "summary", "Summary")),
    payload: asNullableString(readField(obj, "payload", "Payload")),
    createdAt,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const limit = clampLimit(url.searchParams.get("limit"));
    const cursor = url.searchParams.get("cursor");
    const taskId = url.searchParams.get("taskId");
    const direction = url.searchParams.get("direction") === "newer" ? "newer" : "older";

    const upstreamURL = new URL(`${getGoEngineURL()}/engine/projects/${id}/timeline`);
    upstreamURL.searchParams.set("limit", String(limit));
    if (cursor) upstreamURL.searchParams.set("cursor", cursor);
    upstreamURL.searchParams.set("direction", direction);
    if (taskId) upstreamURL.searchParams.set("task_id", taskId);

    const upstream = await fetch(upstreamURL.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(body ?? { error: "Failed to load timeline" }, { status: upstream.status });
    }

    const events = Array.isArray(body?.events)
      ? (body.events as unknown[])
          .map(normalizeEvent)
          .filter((event): event is TimelineEvent => event !== null)
      : [];
    const nextCursor =
      typeof body?.nextCursor === "string"
        ? body.nextCursor
        : typeof body?.next_cursor === "string"
          ? body.next_cursor
          : null;

    return NextResponse.json({
      items: events,
      nextCursor,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load timeline" },
      { status: 502 }
    );
  }
}
