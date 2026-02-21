/**
 * ProjectWorkflow：薄调度层。项目生命周期由「员工充血模型」驱动，见 @core/employee。
 *
 * 使用 goroutine 风格：每员工一个常驻 async 循环 + 信箱，收到待办即被唤醒执行。
 */

import { prisma } from "@/lib/db";
import { agentRuntime } from "@/core/agent/runtime";
import { messageBus } from "@/core/communication/message-bus";
import {
  runEmployee,
  launchProjectGoroutines,
  getProjectRun,
  notifyFounderMessage,
} from "@/core/employee";
import { projectManager } from "./manager";
import type { AgentEvent } from "@/core/agent/types";

const MAX_LOOP_ITERATIONS = 20;

export class ProjectWorkflow {
  private eventHandlers: ((event: AgentEvent) => void)[] = [];

  onEvent(handler: (event: AgentEvent) => void) {
    this.eventHandlers.push(handler);
    agentRuntime.onEvent(handler);
  }

  async startProject(projectId: string): Promise<void> {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        company: {
          include: { employees: { include: { role: true } } },
        },
      },
    });

    const ceo = project.company.employees.find((e) => e.role.name === "ceo");
    if (!ceo) {
      throw new Error("No CEO found in the company. Please hire a CEO first.");
    }

    const brief = project.description
      ? `**${project.name}**\n\n${project.description}`
      : `**${project.name}**`;

    await messageBus.send({
      projectId,
      senderType: "founder",
      messageType: "founder_message",
      content: `I'd like to initiate this project: ${brief}`,
    });

    await projectManager.updateStatus(projectId, "in_progress");

    launchProjectGoroutines(projectId);
  }

  async resumeProject(projectId: string): Promise<void> {
    launchProjectGoroutines(projectId);
  }

  /** Founder 验收通过时可将项目标为 completed；常见表述视为验收通过 */
  private isFounderAcceptance(content: string): boolean {
    const t = content.trim().toLowerCase();
    return (
      /验收通过|通过验收|通过$|^通过\s|接受|确认完成/.test(content) ||
      /\baccept(ed)?\b|\bapproved?\b/.test(t)
    );
  }

  async founderMessage(projectId: string, message: string): Promise<void> {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        company: {
          include: { employees: { include: { role: true } } },
        },
      },
    });

    const ceo = project.company.employees.find((e) => e.role.name === "ceo");
    if (!ceo) {
      throw new Error("No CEO found in the company.");
    }

    if (
      project.status === "review" &&
      this.isFounderAcceptance(message)
    ) {
      await projectManager.updateStatus(projectId, "completed");
      await messageBus.send({
        projectId,
        senderType: "founder",
        messageType: "founder_message",
        content: message,
      });
      return;
    }

    await messageBus.send({
      projectId,
      senderType: "founder",
      messageType: "founder_message",
      content: message,
    });

    if (getProjectRun(projectId)) {
      notifyFounderMessage(projectId, message);
      return;
    }

    const result = await runEmployee(projectId, ceo.id, {
      iteration: 0,
      maxIterations: MAX_LOOP_ITERATIONS,
      founderMessage: message,
    });

    if (result.shouldStop) return;

    if ((result.runEmployeeIds?.length ?? 0) > 0) {
      await Promise.all(
        result.runEmployeeIds!.map((eid) =>
          runEmployee(projectId, eid, {
            iteration: 0,
            maxIterations: MAX_LOOP_ITERATIONS,
          })
        )
      );
    }

    await this.runProjectLoop(projectId);
  }

  /**
   * 调度循环：每轮先跑 CEO，再并行跑本轮需执行的员工（收到待办或被打回修改）。
   */
  private async runProjectLoop(projectId: string): Promise<void> {
    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
      try {
        const project = await prisma.project.findUniqueOrThrow({
          where: { id: projectId },
          include: {
            company: {
              include: { employees: { include: { role: true } } },
            },
            tasks: { select: { status: true } },
          },
        });

        if (
          project.status === "completed" ||
          project.status === "failed"
        ) {
          break;
        }

        const ceo = project.company.employees.find(
          (e) => e.role.name === "ceo"
        );
        if (!ceo) break;

        const result = await runEmployee(projectId, ceo.id, {
          iteration,
          maxIterations: MAX_LOOP_ITERATIONS,
        });

        if (result.shouldStop) break;

        const runIds = result.runEmployeeIds ?? [];
        if (runIds.length > 0) {
          await Promise.all(
            runIds.map((eid) =>
              runEmployee(projectId, eid, {
                iteration,
                maxIterations: MAX_LOOP_ITERATIONS,
              })
            )
          );
        } else {
          // Re-fetch project after CEO run to see current task state
          const projectNow = await prisma.project.findUniqueOrThrow({
            where: { id: projectId },
            include: { tasks: { select: { status: true } } },
          });
          const tasksNeedingAttention = projectNow.tasks.some((t) =>
            ["pending", "assigned", "in_progress", "review", "blocked"].includes(t.status)
          );
          // Only say "waiting for Founder" when no tasks need work (do not send when tasks are still in review even if project status is "review")
          if (!tasksNeedingAttention) {
            await messageBus.send({
              projectId,
              senderType: "system",
              messageType: "status_update",
              content:
                "CEO has completed the current round of work. Waiting for further instructions from the Founder.",
            });
            break;
          }
        }
      } catch (error) {
        console.error(
          `Project loop iteration ${iteration} failed for ${projectId}:`,
          error
        );
        await messageBus.send({
          projectId,
          senderType: "system",
          messageType: "status_update",
          content: `⚠️ An error occurred during iteration ${iteration + 1}: ${error instanceof Error ? error.message : "Unknown error"}. The system will retry.`,
        });
        if (iteration >= 2) break;
      }
    }
  }
}

export const projectWorkflow = new ProjectWorkflow();
