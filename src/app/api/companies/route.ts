import { NextResponse } from "next/server";
import { companyManager, CreateCompanySchema } from "@/core/company";

// GET: return the single company (or null)
export async function GET() {
  try {
    const company = await companyManager.getCompany();
    return NextResponse.json(company);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get company" },
      { status: 500 }
    );
  }
}

// POST: initialize the company (only once)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = CreateCompanySchema.parse(body);
    const company = await companyManager.initCompany(input);
    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create company" },
      { status: 400 }
    );
  }
}
