import { NextResponse } from "next/server";
import { companyManager, HireEmployeeSchema } from "@/core/company";

// POST: hire an employee (company id taken from single company)
export async function POST(request: Request) {
  try {
    const companyId = await companyManager.getCompanyId();
    if (!companyId) {
      return NextResponse.json(
        { error: "No company found. Please set up your company first." },
        { status: 400 }
      );
    }
    const body = await request.json();
    const input = HireEmployeeSchema.parse({ ...body, companyId });
    const employee = await companyManager.hireEmployee(input);
    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to hire employee" },
      { status: 400 }
    );
  }
}
