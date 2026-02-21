/**
 * Goroutine 风格调度：每个员工一个常驻 async 循环。
 * 待办列表以 DB（EmployeeService.getTodoQueue）为准；员工侧的「信箱」只是唤醒信号，
 * 被唤醒后从 getTodoQueue 取第一个任务执行，与待办列表合二为一。
 */

import { prisma } from "@/lib/db";
import { messageBus } from "@/core/communication/message-bus";
import { projectManager } from "@/core/project/manager";
import { Mailbox, WakeSignal } from "./mailbox";
import { employeeService } from "./service";
import { runCeoCycle } from "./ceo-cycle";
import { executeTaskForEmployee } from "./worker-cycle";
import { retryTaskExecution } from "./retry";

const MAX_CEO_ITERATIONS = 200;

export type CeoTrigger =
  | "run"
  | { type: "founder"; message: string };

/** 某项目的 goroutine 运行时：CEO 信箱 + 员工唤醒信号（待办来自 DB） */
export interface ProjectGoroutineRun {
  ceoTrigger: Mailbox<CeoTrigger>;
  employeeWakeSignals: Map<string, WakeSignal>;
  stop(): void;
}

const projectRuns = new Map<string, ProjectGoroutineRun>();

export function getProjectRun(projectId: string): ProjectGoroutineRun | undefined {
  return projectRuns.get(projectId);
}

/**
 * 触发 CEO 处理 Founder 消息（goroutine 模式下由 API 调用）
 */
export function notifyFounderMessage(projectId: string, message: string): void {
  const run = projectRuns.get(projectId);
  if (run) {
    run.ceoTrigger.push({ type: "founder", message });
  }
}

/**
 * 启动项目的 goroutine 风格运行：为每个员工和 CEO 各起一个常驻 async 循环。
 * 调用后立即返回，循环在后台运行。
 */
export function launchProjectGoroutines(projectId: string): void {
  void (async () => {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        company: {
          include: { employees: { include: { role: true } } },
        },
      },
    });

    const ceo = project.company.employees.find((e) => e.role.name === "ceo");
    if (!ceo) return;

    const ceoTrigger = new Mailbox<CeoTrigger>();
    const employeeWakeSignals = new Map<string, WakeSignal>();

    for (const emp of project.company.employees) {
      if (emp.role.name === "ceo") continue;
      employeeWakeSignals.set(emp.id, new WakeSignal());
    }

    const stop = () => {
      ceoTrigger.stop();
      employeeWakeSignals.forEach((s) => s.stop());
      projectRuns.delete(projectId);
    };

    projectRuns.set(projectId, {
      ceoTrigger,
      employeeWakeSignals,
      stop,
    });

    const onTaskAssigned = (employeeId: string, _taskId: string) => {
      employeeWakeSignals.get(employeeId)?.push();
    };

    // 员工 goroutine：被唤醒后从 DB 待办列表取第一个任务执行（待办与唤醒合二为一）
    const runEmployeeLoop = async (employeeId: string) => {
      const wake = employeeWakeSignals.get(employeeId)!;
      for (;;) {
        const ok = await wake.next();
        if (!ok) return;

        const queue = await employeeService.getTodoQueue(employeeId, projectId);
        if (queue.length === 0) continue;

        const taskId = queue[0].taskId;
        try {
          await retryTaskExecution(
            () => executeTaskForEmployee(taskId),
            (attempt) => {
              messageBus
                .send({
                  projectId,
                  taskId,
                  senderType: "system",
                  messageType: "status_update",
                  content: `Task failed (attempt ${attempt}/3), retrying...`,
                })
                .catch(() => {});
            }
          );
        } catch (error) {
          await projectManager.updateTaskStatus(taskId, "blocked");
          await messageBus.send({
            projectId,
            taskId,
            senderType: "system",
            messageType: "status_update",
            content: `Task execution failed after 3 attempts: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }

        ceoTrigger.push("run");
      }
    };

    // CEO goroutine：等触发，跑一轮，分配时通过 onTaskAssigned 唤醒员工
    const runCeoLoop = async () => {
      let iteration = 0;
      for (;;) {
        const msg = await ceoTrigger.next();
        if (msg === null) {
          return;
        }

        const projectNow = await prisma.project.findUnique({
          where: { id: projectId },
          select: { status: true },
        });
        if (
          projectNow?.status === "completed" ||
          projectNow?.status === "failed"
        ) {
          stop();
          return;
        }

        const founderMessage =
          typeof msg === "object" && msg.type === "founder"
            ? msg.message
            : undefined;

        const employees = await prisma.employee.findMany({
          where: { companyId: project.companyId },
          include: { role: true },
        });

        const result = await runCeoCycle(projectId, employees, {
          iteration: Math.min(iteration, MAX_CEO_ITERATIONS - 1),
          maxIterations: MAX_CEO_ITERATIONS,
          founderMessage,
          onTaskAssigned,
        });

        iteration++;

        if (result.shouldStop) {
          stop();
          return;
        }
        // Keep CEO loop running while project is in progress or planning (review = wait for Founder, no push)
        const projectAfter = await prisma.project.findUnique({
          where: { id: projectId },
          select: { status: true },
        });
        if (
          projectAfter?.status === "in_progress" ||
          projectAfter?.status === "planning"
        ) {
          ceoTrigger.push("run");
        }
      }
    };

    for (const emp of project.company.employees) {
      if (emp.role.name === "ceo") continue;
      void runEmployeeLoop(emp.id);
    }
    void runCeoLoop();

    ceoTrigger.push("run");
  })();
}
