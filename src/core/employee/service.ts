/**
 * EmployeeService: 员工待办队列与「提交任务」的封装。
 *
 * 对应员工模型中的：
 * - 属性：待办任务队列、当前执行的任务
 * - 方法：提交任务（向员工待办队列提交）
 *
 * 执行/汇报/审核由 ProjectWorkflow 与 AgentRuntime 负责，本服务只做队列与分配。
 */

import { prisma } from "@/lib/db";
import { projectManager } from "@/core/project/manager";
import type { TodoQueue, CurrentTask, SubmitTaskInput } from "./types";

const QUEUE_STATUSES = ["assigned", "in_progress"] as const;

export class EmployeeService {
  /**
   * 获取员工在某项目下的待办任务队列（含当前执行中的任务，按：先 in_progress，再按 assignedAt 升序）。
   */
  async getTodoQueue(
    employeeId: string,
    projectId: string
  ): Promise<TodoQueue> {
    const assignments = await prisma.taskAssignment.findMany({
      where: {
        employeeId,
        task: {
          projectId,
          status: { in: [...QUEUE_STATUSES] },
        },
      },
      include: { task: true },
      orderBy: [{ task: { status: "desc" } }, { assignedAt: "asc" }],
    });

    return assignments.map((a) => ({
      taskId: a.task.id,
      title: a.task.title,
      status: a.task.status,
    }));
  }

  /**
   * 获取员工在某项目下当前正在执行的任务（最多一条）。
   */
  async getCurrentTask(
    employeeId: string,
    projectId: string
  ): Promise<CurrentTask | null> {
    const a = await prisma.taskAssignment.findFirst({
      where: {
        employeeId,
        task: {
          projectId,
          status: "in_progress",
        },
      },
      include: { task: true },
    });
    if (!a) return null;
    const t = a.task;
    return {
      taskId: t.id,
      projectId: t.projectId,
      title: t.title,
      description: t.description,
      status: t.status,
    };
  }

  /**
   * 提交任务：将任务加入指定员工的待办队列（创建 TaskAssignment，任务状态设为 assigned）。
   */
  async submitTask(input: SubmitTaskInput): Promise<void> {
    const { projectId, employeeId, taskId } = input;
    await projectManager.assignTask(taskId, employeeId);
  }
}

export const employeeService = new EmployeeService();
