/**
 * 普通员工实现：有待办队列与当前任务，从队列取任务 → 分析规划 → 执行 → 汇报。
 */

import { employeeService } from "./service";
import { runWorkerCycle } from "./worker-cycle";
import { Employee, type EmployeeRunResult, type RunOptions } from "./employee";
import type { TodoQueue, CurrentTask } from "./types";

export class WorkerEmployee extends Employee {
  /** 待办任务队列（来自 DB，只读） */
  async getTodoQueue(): Promise<TodoQueue> {
    return employeeService.getTodoQueue(this.id, this.projectId);
  }

  /** 当前正在执行的任务（来自 DB） */
  async getCurrentTask(): Promise<CurrentTask | null> {
    return employeeService.getCurrentTask(this.id, this.projectId);
  }

  override async run(_options: RunOptions): Promise<EmployeeRunResult> {
    await runWorkerCycle(this.projectId, this.id);
    return {};
  }
}
