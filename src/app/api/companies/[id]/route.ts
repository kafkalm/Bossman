import { NextResponse } from "next/server";
import { companyManager } from "@/core/company";

// GET: get the single company (id param is kept for backward compatibility)
export async function GET() {
  try {
    const company = await companyManager.getCompany();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    return NextResponse.json(company);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get company" },
      { status: 500 }
    );
  }
}
