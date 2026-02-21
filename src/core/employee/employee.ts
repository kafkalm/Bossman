/**
 * 员工抽象类：CEO 与普通员工是两种实现。
 *
 * 属性（概念）：
 * - 待办任务队列：Worker 有（来自 DB）；CEO 无此队列，由事件/轮次驱动。
 * - 当前执行的任务：Worker 有（最多一个）；CEO 无。
 *
 * 方法（概念）：
 * - 提交任务：向本员工待办队列提交（receiveTask），Worker 写入 DB，CEO 可 no-op。
 * - 分析规划任务、执行任务、汇报任务：Worker 在一次 run 内完成；CEO 不执行具体任务。
 * - 审核任务：仅 CEO 实现（approve / request_revision）。
 */

import { employeeService } from "./service";

export type EmployeeRunResult = {
  shouldStop?: boolean;
  runEmployeeIds?: string[];
};

export type RunOptions = {
  iteration: number;
  maxIterations: number;
  founderMessage?: string;
  onTaskAssigned?: (employeeId: string, taskId: string) => void;
};

export abstract class Employee {
  constructor(
    public readonly id: string,
    public readonly projectId: string,
    public readonly roleName: string
  ) {}

  /** 向本员工待办队列提交一个任务（被分配或打回时调用） */
  receiveTask(taskId: string): Promise<void> {
    return employeeService.submitTask({
      projectId: this.projectId,
      employeeId: this.id,
      taskId,
    });
  }

  /** 执行一次运行周期；由调度器在适当时机调用 */
  abstract run(options: RunOptions): Promise<EmployeeRunResult>;
}
