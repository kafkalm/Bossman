/**
 * CEO 实现：无待办任务队列，由轮次/事件驱动；负责分配任务与审核。
 */

import { prisma } from "@/lib/db";
import { runCeoCycle } from "./ceo-cycle";
import { Employee, EmployeeRunResult, RunOptions } from "./employee";

export class CeoEmployee extends Employee {
  /**
   * CEO 无「待办队列」概念，分配进来的任务由 processCeoToolCalls 直接写入 DB 并唤醒对应员工。
   * receiveTask 对 CEO 无意义，可 no-op。
   */
  override receiveTask(_taskId: string): Promise<void> {
    return Promise.resolve();
  }

  override async run(options: RunOptions): Promise<EmployeeRunResult> {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: this.projectId },
      include: {
        company: {
          include: { employees: { include: { role: true } } },
        },
      },
    });

    const result = await runCeoCycle(this.projectId, project.company.employees, {
      iteration: options.iteration,
      maxIterations: options.maxIterations,
      founderMessage: options.founderMessage,
      onTaskAssigned: options.onTaskAssigned,
    });

    return {
      shouldStop: result.shouldStop,
      runEmployeeIds: result.runEmployeeIds,
    };
  }
}
