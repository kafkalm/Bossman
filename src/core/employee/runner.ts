/**
 * 员工运行器入口：根据 employeeId + projectId 加载员工，构造对应子类并执行一次 run()。
 */

import { prisma } from "@/lib/db";
import { Employee, type EmployeeRunResult, type RunOptions } from "./employee";
import { CeoEmployee } from "./ceo-employee";
import { WorkerEmployee } from "./worker-employee";

export function createEmployee(
  employeeId: string,
  projectId: string,
  roleName: string
): Employee {
  return roleName === "ceo"
    ? new CeoEmployee(employeeId, projectId, roleName)
    : new WorkerEmployee(employeeId, projectId, roleName);
}

export async function runEmployee(
  projectId: string,
  employeeId: string,
  options: RunOptions
): Promise<EmployeeRunResult> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { role: true },
  });

  const emp = createEmployee(employee.id, projectId, employee.role.name);
  return emp.run(options);
}
