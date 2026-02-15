import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parse } from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");

// GET: read the .env file content
export async function GET() {
  try {
    if (!fs.existsSync(envPath)) {
      return NextResponse.json({ content: "" });
    }
    const content = fs.readFileSync(envPath, "utf-8");
    return NextResponse.json({ content });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read .env" },
      { status: 500 }
    );
  }
}

// POST: write the .env file and dynamically reload env vars
export async function POST(request: Request) {
  try {
    const { content } = await request.json();
    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "content must be a string" },
        { status: 400 }
      );
    }

    // Write .env file
    fs.writeFileSync(envPath, content, "utf-8");

    // Parse the new env and apply to process.env with override
    const parsed = parse(content);
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = value;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to write .env",
      },
      { status: 500 }
    );
  }
}
