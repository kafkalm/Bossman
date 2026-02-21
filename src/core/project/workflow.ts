import { z } from "zod";
import { prisma } from "@/lib/db";
import { agentRuntime } from "@/core/agent/runtime";
import { messageBus } from "@/core/communication/message-bus";
import { projectManager } from "./manager";
import type { ToolDefinition } from "@/core/llm/types";
import type { AgentEvent } from "@/core/agent/types";

/**
 * ProjectWorkflow orchestrates the entire project lifecycle with an
 * autonomous CEO loop:
 *
 * 1. Founder creates project → CEO kicks off
 * 2. CEO continuously evaluates project state
 * 3. CEO assigns tasks, reviews results, compiles documents
 * 4. Loop runs until CEO marks the project as "completed"
 *
 * The CEO acts as a persistent project manager, deciding what to do
 * at each iteration based on the current state of all tasks and deliverables.
 */

const MAX_LOOP_ITERATIONS = 20;

/** Max retries for task execution when LLM/API fails. */
const TASK_EXECUTION_MAX_RETRIES = 3;

/** Delay in ms before each retry (exponential: 2s, 4s, 8s). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTaskExecution<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, error: unknown) => void
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TASK_EXECUTION_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < TASK_EXECUTION_MAX_RETRIES - 1) {
        const delayMs = 2000 * Math.pow(2, attempt);
        onRetry?.(attempt + 1, error);
        await sleep(delayMs);
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

export class ProjectWorkflow {
  private eventHandlers: ((event: AgentEvent) => void)[] = [];

  onEvent(handler: (event: AgentEvent) => void) {
    this.eventHandlers.push(handler);
    agentRuntime.onEvent(handler);
  }

  // ───────── Public API ─────────

  /**
   * Start a new project: send the founder brief to the CEO, then
   * enter the autonomous management loop.
   */
  async startProject(projectId: string): Promise<void> {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        company: {
          include: { employees: { include: { role: true } } },
        },
      },
    });

    const ceo = project.company.employees.find(
      (e) => e.role.name === "ceo"
    );
    if (!ceo) {
      throw new Error("No CEO found in the company. Please hire a CEO first.");
    }

    // Record founder brief
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

    // Enter the autonomous loop
    await this.runProjectLoop(projectId);
  }

  /**
   * Resume the CEO loop for an in-progress project.
   * Call this on startup to continue any projects that were interrupted.
   */
  async resumeProject(projectId: string): Promise<void> {
    await this.runProjectLoop(projectId);
  }

  /**
   * Send a message from the Founder to the CEO.
   * The CEO responds and may trigger further actions or resume the loop.
   */
  async founderMessage(projectId: string, message: string): Promise<void> {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        company: {
          include: { employees: { include: { role: true } } },
        },
      },
    });

    const ceo = project.company.employees.find(
      (e) => e.role.name === "ceo"
    );
    if (!ceo) {
      throw new Error("No CEO found in the company.");
    }

    // Record founder message
    await messageBus.send({
      projectId,
      senderType: "founder",
      messageType: "founder_message",
      content: message,
    });

    // Gather state snapshot for the CEO
    const snapshot = await this.buildProjectSnapshot(projectId);
    const tools = buildCeoTools(project.company.employees);

    const contextMessage = `[Founder]: ${message}

---

${snapshot}

Respond to the Founder's message. If action is needed, use the appropriate tools. If the Founder asks you to resume work or compile a document, take the corresponding action.`;

    const result = await agentRuntime.run({
      employeeId: ceo.id,
      projectId,
      tools,
      additionalMessages: [{ role: "user", content: contextMessage }],
    });

    if (result.toolCalls && result.toolCalls.length > 0) {
      const shouldStop = await this.processToolCalls(
        projectId,
        project.company.employees,
        result.toolCalls
      );

      // If the CEO assigned new tasks (but didn't stop), resume the loop
      // to continue monitoring
      const hasNewTasks = result.toolCalls.some(
        (tc) => tc.name === "assign_task"
      );
      if (!shouldStop && hasNewTasks) {
        // Continue the loop from the next iteration
        await this.runProjectLoop(projectId);
      }
    }
  }

  // ───────── Core Loop ─────────

  /**
   * The autonomous CEO management loop.
   * Each iteration: gather state → CEO decides → execute actions → repeat.
   * Exits when CEO marks the project completed/failed, or max iterations reached.
   */
  private async runProjectLoop(projectId: string): Promise<void> {
    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
      try {
        // Refresh project state
        const project = await prisma.project.findUniqueOrThrow({
          where: { id: projectId },
          include: {
            company: {
              include: { employees: { include: { role: true } } },
            },
            tasks: {
              include: {
                assignments: {
                  include: { employee: { include: { role: true } } },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });

        // Exit if project is already done
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

        // Build state snapshot and prompt
        const snapshot = await this.buildProjectSnapshot(projectId);
        const tools = buildCeoTools(project.company.employees);
        const prompt = buildIterationPrompt(
          project.name,
          project.description,
          snapshot,
          iteration,
          MAX_LOOP_ITERATIONS
        );

        // Run CEO
        const result = await agentRuntime.run({
          employeeId: ceo.id,
          projectId,
          tools,
          additionalMessages: [{ role: "user", content: prompt }],
        });

        // Process tool calls
        if (result.toolCalls && result.toolCalls.length > 0) {
          const shouldStop = await this.processToolCalls(
            projectId,
            project.company.employees,
            result.toolCalls
          );
          if (shouldStop) break;
        } else {
          // CEO made no tool calls. Only treat as "completed" when no tasks need attention.
          const tasksNeedingAttention = project.tasks.filter((t) =>
            ["assigned", "in_progress", "review", "blocked"].includes(t.status)
          );
          if (tasksNeedingAttention.length > 0) {
            // CEO should be acting on these tasks; give another iteration
            continue;
          }
          if (iteration > 0) {
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
        // If first iteration failed, don't keep retrying endlessly
        if (iteration >= 2) break;
      }
    }
  }

  // ───────── Tool Call Processing ─────────

  /**
   * Process all tool calls from the CEO. Returns true if the project should stop.
   * assign_task calls are batched: create+assign all first, then execute concurrently.
   */
  private async processToolCalls(
    projectId: string,
    employees: Array<{
      id: string;
      name: string;
      role: { name: string; title: string };
    }>,
    toolCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>
  ): Promise<boolean> {
    let shouldStop = false;

    // Phase 1: Process all assign_task — create and assign, collect for concurrent execution
    const tasksToExecute: { taskId: string; taskTitle: string }[] = [];
    for (const tc of toolCalls) {
      if (tc.name !== "assign_task") continue;
      const { roleName, taskTitle, taskDescription, priority } =
        tc.args as {
          roleName: string;
          taskTitle: string;
          taskDescription: string;
          priority?: number;
        };

      const employee = employees.find((e) => e.role.name === roleName);
      if (!employee) {
        console.warn(`No employee found with role: ${roleName}`);
        await messageBus.send({
          projectId,
          senderType: "system",
          messageType: "status_update",
          content: `⚠️ Could not assign task "${taskTitle}" — no employee with role "${roleName}" found.`,
        });
        continue;
      }

      const task = await projectManager.createTask({
        projectId,
        title: taskTitle,
        description: taskDescription,
        priority: priority ?? 5,
      });

      await projectManager.assignTask(task.id, employee.id);

      await messageBus.send({
        projectId,
        taskId: task.id,
        senderType: "system",
        messageType: "task_assignment",
        content: `Task "${taskTitle}" has been assigned to ${employee.name} (${employee.role.title}).`,
        metadata: { taskId: task.id, employeeId: employee.id },
      });

      tasksToExecute.push({ taskId: task.id, taskTitle });
    }

    // Phase 2: Execute all assigned tasks concurrently
    if (tasksToExecute.length > 0) {
      await Promise.all(
        tasksToExecute.map(({ taskId, taskTitle }) =>
          (async () => {
            try {
              await retryTaskExecution(
                () => this.executeTask(taskId),
                (attempt, error) => {
                  console.warn(
                    `Task ${taskId} attempt ${attempt} failed, retrying:`,
                    error
                  );
                  messageBus
                    .send({
                      projectId,
                      taskId,
                      senderType: "system",
                      messageType: "status_update",
                      content: `Task "${taskTitle}" failed (attempt ${attempt}/${TASK_EXECUTION_MAX_RETRIES}), retrying in a few seconds...`,
                    })
                    .catch(() => {});
                }
              );
            } catch (error) {
              console.error(`Task execution failed for ${taskId}:`, error);
              await projectManager.updateTaskStatus(taskId, "blocked");
              await messageBus.send({
                projectId,
                taskId,
                senderType: "system",
                messageType: "status_update",
                content: `Task "${taskTitle}" execution failed after ${TASK_EXECUTION_MAX_RETRIES} attempts: ${error instanceof Error ? error.message : "Unknown error"}`,
              });
            }
          })()
        )
      );
    }

    // Phase 3: Process remaining tool calls
    for (const tc of toolCalls) {
      switch (tc.name) {
        case "assign_task":
          // Already handled above
          break;

        // ── Save Project Document ──
        case "save_project_document": {
          const { document } = tc.args as { document: string };
          await prisma.project.update({
            where: { id: projectId },
            data: { document },
          });
          await messageBus.send({
            projectId,
            senderType: "system",
            messageType: "status_update",
            content:
              "📄 Project document has been compiled and saved. You can view it in the Document tab.",
          });
          break;
        }

        // ── Update Project Status ──
        case "update_project_status": {
          const { status, summary } = tc.args as {
            status: string;
            summary: string;
          };
          await projectManager.updateStatus(projectId, status);
          await messageBus.send({
            projectId,
            senderType: "system",
            messageType: "status_update",
            content: `Project status updated to **${status}**: ${summary}`,
          });
          if (status === "completed" || status === "failed") {
            shouldStop = true;
          }
          break;
        }

        // ── Send Message ──
        case "send_message": {
          const { content } = tc.args as { content: string };
          await messageBus.send({
            projectId,
            senderType: "system",
            messageType: "discussion",
            content: `[CEO] ${content}`,
          });
          break;
        }

        // ── Request Revision (CEO reviews deliverable, sends back for improvement) ──
        case "request_revision": {
          const { taskId: revisionTaskId, feedback } = tc.args as {
            taskId: string;
            feedback: string;
          };
          const revisionTask = await prisma.task.findUnique({
            where: { id: revisionTaskId },
            include: {
              assignments: {
                include: { employee: { include: { role: true } } },
              },
              project: true,
            },
          });
          if (!revisionTask || revisionTask.projectId !== projectId) {
            console.warn(`Task ${revisionTaskId} not found or not in this project`);
            break;
          }
          if (revisionTask.assignments.length === 0) {
            console.warn(`Task ${revisionTaskId} has no assignee`);
            break;
          }
          const assignee = revisionTask.assignments[0].employee;
          await prisma.task.update({
            where: { id: revisionTaskId },
            data: { status: "in_progress", output: null },
          });
          await messageBus.send({
            projectId,
            taskId: revisionTaskId,
            senderType: "system",
            messageType: "status_update",
            content: `[CEO 要求修改] ${assignee.name} 的《${revisionTask.title}》质量不达标，需根据反馈重新编写。`,
          });
          await messageBus.send({
            projectId,
            taskId: revisionTaskId,
            senderType: "system",
            messageType: "discussion",
            content: `[CEO 反馈 - 请按要求修改后重新提交]\n\n${feedback}`,
          });
          try {
            await retryTaskExecution(() =>
              this.executeTask(revisionTaskId)
            );
          } catch (error) {
            console.error(`Revision execution failed for ${revisionTaskId}:`, error);
            await projectManager.updateTaskStatus(revisionTaskId, "blocked");
            await messageBus.send({
              projectId,
              taskId: revisionTaskId,
              senderType: "system",
              messageType: "status_update",
              content: `修改任务执行失败: ${error instanceof Error ? error.message : "Unknown error"}`,
            });
          }
          break;
        }

        // ── Approve Task (CEO confirms deliverable is satisfactory, task is done) ──
        case "approve_task": {
          const { taskId: approveTaskId, comment } = tc.args as {
            taskId: string;
            comment?: string;
          };
          const approveTask = await prisma.task.findUnique({
            where: { id: approveTaskId },
            include: {
              assignments: { include: { employee: true } },
            },
          });
          if (!approveTask || approveTask.projectId !== projectId) {
            console.warn(`Task ${approveTaskId} not found or not in this project`);
            break;
          }
          await projectManager.updateTaskStatus(approveTaskId, "completed");
          const assignee = approveTask.assignments[0]?.employee;
          const who = assignee ? assignee.name : "assignee";
          await messageBus.send({
            projectId,
            taskId: approveTaskId,
            senderType: "system",
            messageType: "status_update",
            content: comment
              ? `[CEO 已通过] ${approveTask.title}（${who}）— ${comment}`
              : `[CEO 已通过] ${approveTask.title}（${who}）交付已确认。`,
          });
          break;
        }

        // ── Request Info ──
        case "request_info": {
          const { roleName: infoRoleName, question } = tc.args as {
            roleName: string;
            question: string;
          };
          const infoEmployee = employees.find(
            (e) => e.role.name === infoRoleName
          );
          if (infoEmployee) {
            try {
              const infoResult = await retryTaskExecution(() =>
                agentRuntime.run({
                  employeeId: infoEmployee.id,
                  projectId,
                  additionalMessages: [
                    { role: "user", content: `[CEO asks]: ${question}` },
                  ],
                })
              );
              if (infoResult.content) {
                const DOC_THRESHOLD = 150;
                const looksLikeDoc =
                  infoResult.content.includes("##") ||
                  infoResult.content.startsWith("# ");
                if (
                  infoResult.content.length > DOC_THRESHOLD ||
                  looksLikeDoc
                ) {
                  const brief =
                    infoResult.content.length > 80
                      ? infoResult.content.slice(0, 80).trim() + "…"
                      : infoResult.content;
                  const title =
                    question.length > 40
                      ? question.slice(0, 40).trim() + "…"
                      : question;
                  const file = await prisma.projectFile.create({
                    data: {
                      projectId,
                      employeeId: infoEmployee.id,
                      taskId: null,
                      title: `${infoEmployee.name} 回复：${title}`,
                      content: infoResult.content,
                      brief,
                      fileType: "document",
                    },
                  });
                  await messageBus.send({
                    projectId,
                    senderId: infoEmployee.id,
                    senderType: "agent",
                    messageType: "deliverable",
                    content: `[${infoEmployee.name} replies to CEO] ${brief} → 查看文档`,
                    metadata: {
                      fileId: file.id,
                      brief,
                      fileType: "document",
                    },
                  });
                } else {
                  await messageBus.send({
                    projectId,
                    senderId: infoEmployee.id,
                    senderType: "agent",
                    messageType: "discussion",
                    content: `[${infoEmployee.name} replies to CEO]: ${infoResult.content}`,
                  });
                }
              }
            } catch (error) {
              console.error(`request_info from ${infoRoleName} failed:`, error);
              await messageBus.send({
                projectId,
                senderType: "system",
                messageType: "status_update",
                content: `Request to ${infoEmployee.name} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              });
            }
          }
          break;
        }
      }
    }

    return shouldStop;
  }

  // ───────── Task Execution ─────────

  /**
   * Execute a specific task: the assigned agent works on it.
   */
  async executeTask(taskId: string): Promise<void> {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        assignments: {
          include: { employee: { include: { role: true } } },
        },
        project: true,
      },
    });

    if (task.assignments.length === 0) {
      throw new Error("Task has no assigned employee.");
    }

    const employee = task.assignments[0].employee;

    await projectManager.updateTaskStatus(taskId, "in_progress");

    const agentTools = getAgentTools();

    const result = await agentRuntime.run({
      employeeId: employee.id,
      projectId: task.projectId,
      taskId: task.id,
      tools: agentTools,
    });

    let taskOutput: string | null = null;

    const createFileAndShortMessage = async (
      content: string,
      title: string,
      fileType: "document" | "code" = "document",
      path?: string | null
    ): Promise<string> => {
      const safeContent = typeof content === "string" ? content : "";
      const brief =
        safeContent.length > 80
          ? safeContent.slice(0, 80).trim() + "…"
          : safeContent;
      const file = await prisma.projectFile.create({
        data: {
          projectId: task.projectId,
          employeeId: employee.id,
          taskId: task.id,
          title,
          path: path ?? null,
          content: safeContent,
          brief,
          fileType,
        },
      });
      const tabLabel = fileType === "code" ? "查看代码" : "查看文档";
      await messageBus.send({
        projectId: task.projectId,
        taskId: task.id,
        senderId: employee.id,
        senderType: "agent",
        messageType: "deliverable",
        content: `[${employee.name}] 已提交《${title}》→ ${tabLabel}`,
        metadata: { fileId: file.id, brief, fileType },
      });
      return file.id;
    };

    if (result.toolCalls) {
      const reports: string[] = [];
      for (const tc of result.toolCalls) {
        if (tc.name === "report_to_ceo") {
          const { report } = tc.args as { report?: string };
          const reportContent = typeof report === "string" ? report : "";
          reports.push(reportContent);
          await createFileAndShortMessage(reportContent, task.title, "document");
        } else if (tc.name === "create_file" || tc.name === "save_to_workspace") {
          const args = tc.args as {
            title?: string;
            content?: string;
            fileType?: "document" | "code";
            path?: string;
          };
          const title = args.title ?? "untitled";
          const content = args.content ?? "";
          const fileType =
            args.fileType ?? (tc.name === "save_to_workspace" ? "document" : "code");
          const path = args.path;
          await createFileAndShortMessage(content, title, fileType, path);
          reports.push(
            `[${employee.name}] 已保存${fileType === "code" ? "代码" : "文档"}${path ? ` → ${path}/` : ""}${title}`
          );
        } else if (tc.name === "ask_colleague") {
          const { question, colleague_role } = tc.args as {
            question: string;
            colleague_role: string;
          };
          await messageBus.send({
            projectId: task.projectId,
            taskId: task.id,
            senderId: employee.id,
            senderType: "agent",
            messageType: "discussion",
            content: `[${employee.name} asks ${colleague_role}]: ${question}`,
          });
        }
      }
      if (reports.length > 0) {
        taskOutput = reports.join("\n\n---\n\n");
      }
    }

    if (!taskOutput && result.content) {
      taskOutput = result.content;
      await createFileAndShortMessage(result.content, task.title);
    }

    if (taskOutput) {
      await prisma.task.update({
        where: { id: task.id },
        data: { output: taskOutput, status: "review" },
      });
    }
  }

  // ───────── State Snapshot ─────────

  /**
   * Build a text snapshot of the current project state for the CEO.
   */
  private async buildProjectSnapshot(projectId: string): Promise<string> {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        company: {
          include: { employees: { include: { role: true } } },
        },
        tasks: {
          include: {
            assignments: {
              include: { employee: { include: { role: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const lines: string[] = [];

    // Team
    lines.push("## Team Members");
    for (const emp of project.company.employees) {
      if (emp.role.name === "ceo") continue;
      lines.push(`- **${emp.name}** — ${emp.role.title} (role: \`${emp.role.name}\`)`);
    }

    // Project document status
    lines.push("");
    lines.push(
      `## Project Document: ${project.document ? "✅ Saved" : "❌ Not yet compiled"}`
    );

    // Tasks
    lines.push("");
    lines.push("## Tasks");
    if (project.tasks.length === 0) {
      lines.push("_No tasks have been created yet._");
    } else {
      const statusEmoji: Record<string, string> = {
        pending: "⏳",
        assigned: "📋",
        in_progress: "🔄",
        completed: "✅",
        blocked: "❌",
        review: "🔍",
      };
      for (const task of project.tasks) {
        const assignee = task.assignments[0]?.employee;
        const who = assignee
          ? `${assignee.name} (${assignee.role.title})`
          : "Unassigned";
        const emoji = statusEmoji[task.status] ?? "❓";
        lines.push(
          `${emoji} **[${task.status.toUpperCase()}]** ${task.title} — assigned to ${who} (taskId: \`${task.id}\`)`
        );
        if (task.output) {
          // Truncate long outputs to keep context manageable
          const truncated =
            task.output.length > 500
              ? task.output.slice(0, 500) + "\n... (truncated)"
              : task.output;
          lines.push(`  > Output:\n${truncated}`);
        }
      }
    }

    // Summary counts
    const total = project.tasks.length;
    const completed = project.tasks.filter(
      (t) => t.status === "completed"
    ).length;
    const inReview = project.tasks.filter(
      (t) => t.status === "review"
    ).length;
    const blocked = project.tasks.filter(
      (t) => t.status === "blocked"
    ).length;
    const inProgress = project.tasks.filter(
      (t) => t.status === "in_progress"
    ).length;
    if (total > 0) {
      lines.push("");
      lines.push(
        `**Progress**: ${completed}/${total} completed, ${inReview} in review, ${inProgress} in-progress, ${blocked} blocked`
      );
    }

    // Recent messages (employee questions, CEO replies, etc.)
    const recentMessages = await prisma.message.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { sender: { include: { role: true } } },
    });
    recentMessages.reverse();
    if (recentMessages.length > 0) {
      lines.push("");
      lines.push("## Recent Messages (questions, replies, updates)");
      for (const msg of recentMessages) {
        const label =
          msg.senderType === "founder"
            ? "Founder"
            : msg.senderType === "system"
              ? "System"
              : msg.sender
                ? `${msg.sender.name} (${msg.sender.role.title})`
                : "Unknown";
        const preview =
          msg.content.length > 200
            ? msg.content.slice(0, 200).trim() + "…"
            : msg.content;
        lines.push(`- [${label}]: ${preview}`);
      }
    }

    return lines.join("\n");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Prompt Builder
// ════════════════════════════════════════════════════════════════════════════

function buildIterationPrompt(
  projectName: string,
  projectDescription: string,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  return `You are the CEO continuously managing the project **"${projectName}"**.
${projectDescription ? `Project brief: ${projectDescription}\n` : ""}
This is **management cycle ${iteration + 1}/${maxIterations}**.

Here is the current state of the project:

${snapshot}

---

**Your responsibilities as the autonomous project manager:**

- **Task completion is decided only by you.** When an employee submits a deliverable, the task goes to "review". It is NOT complete until you call \`approve_task\`. If the employee has asked questions or requested clarification (see Recent Messages), do NOT approve until you have answered — use \`send_message\` to reply to everyone, or \`request_info\` to ask another employee and then share the answer. Only when you are satisfied and any clarifications are resolved should you call \`approve_task\`.

1. **If no tasks exist yet**: This is the start. Analyze the project, then use \`assign_task\` **for all relevant team members in one turn** so they work concurrently. Start with the **project initiation / documentation phase** — assign doc tasks to each relevant role in a single response:
   - **Product Manager**: Requirements analysis, feature scope, user stories, PRD
   - **UI Designer**: Design direction, key page layouts, interaction patterns
   - **Frontend Developer**: Frontend architecture, tech stack, component structure
   - **Backend Developer**: System architecture, API design, database schema
   - **QA Engineer**: Testing strategy, quality criteria, acceptance criteria
   - **Researcher**: Market research, competitive analysis, technical feasibility study
   - **Ideation Specialist**: Creative product ideas, innovation angles, feature brainstorming based on research
   Use multiple \`assign_task\` calls in one response — do NOT assign one task and wait; assign all parallel doc tasks at once so the team executes concurrently.

2. **If there are tasks in "review" or employees have asked questions**: Check **Recent Messages** first. If anyone (e.g. backend engineer) has asked for clarification, answer via \`send_message\` or get an answer via \`request_info\` and then send a summary. Do not \`approve_task\` until clarifications are addressed. For tasks in review: if the deliverable is good, use \`approve_task\`; if not, use \`request_revision\` with concrete feedback. Only when all relevant deliverables are approved and questions answered, use \`save_project_document\` (for doc phase) or move on.

3. **If the project document is saved but no implementation tasks exist**: Plan the **implementation phase**. Break the project into concrete implementation tasks and assign **all tasks that can run in parallel** in one turn (e.g., frontend and backend tasks if independent) so multiple engineers work concurrently.

4. **If implementation tasks are in review**: Same as above — handle any questions in Recent Messages, then for each task in review use \`approve_task\` or \`request_revision\`. When all are approved, use \`update_project_status\` to mark the project **"completed"** with a summary.

5. **If some tasks are blocked or failed**: Decide how to recover — reassign the work, adjust the plan, or ask a team member for clarification.

**Important rules:**
- You MUST use tools to take action. Do not just describe what you would do — actually do it.
- Assign tasks using \`roleName\` (the \`role:\` in the team list). Only you decide when a task is done: use \`approve_task\` when satisfied, \`request_revision\` when not.
- If employees have asked questions (in Recent Messages), answer or delegate answers before approving their tasks.
- When all work is truly done and the project is ready, set the status to "completed". Do NOT leave the project hanging.
- If this is your last cycle (${iteration + 1}/${maxIterations}), you MUST either complete the project or set status to "review".

Take action now.`;
}

// ════════════════════════════════════════════════════════════════════════════
// CEO Tool Definitions
// ════════════════════════════════════════════════════════════════════════════

function buildCeoTools(
  employees: Array<{
    id: string;
    name: string;
    role: { name: string; title: string };
  }>
): ToolDefinition[] {
  const teamMembers = employees
    .filter((e) => e.role.name !== "ceo")
    .map((e) => e.role.name);

  if (teamMembers.length === 0) return [];

  return [
    {
      name: "assign_task",
      description:
        "Create and assign a task to a team member. This can be any kind of task: documentation, implementation, review, research, design, testing, etc.",
      parameters: z.object({
        roleName: z
          .enum(teamMembers as [string, ...string[]])
          .describe("The role of the team member to assign the task to"),
        taskTitle: z.string().describe("A concise title for the task"),
        taskDescription: z
          .string()
          .describe(
            "Detailed description of the task, including context, requirements, and expected deliverables"
          ),
        priority: z
          .number()
          .min(0)
          .max(10)
          .default(5)
          .describe("Priority level (0-10, higher = more important)"),
      }),
    },
    {
      name: "save_project_document",
      description:
        "Save or update the project document. Call this with the complete, well-structured project document in markdown format. Use this after reviewing team contributions to compile a unified document.",
      parameters: z.object({
        document: z
          .string()
          .describe(
            "The complete project document in markdown format, synthesizing all team contributions."
          ),
      }),
    },
    {
      name: "update_project_status",
      description:
        'Update the overall project status. Set to "completed" when all work is done and deliverables are satisfactory.',
      parameters: z.object({
        status: z
          .enum(["planning", "in_progress", "review", "completed", "failed"])
          .describe("The new project status"),
        summary: z
          .string()
          .describe("A brief summary of what has been accomplished"),
      }),
    },
    {
      name: "send_message",
      description:
        "Send an announcement to the project channel, visible to the Founder and all team members.",
      parameters: z.object({
        content: z.string().describe("The message content"),
      }),
    },
    {
      name: "request_revision",
      description:
        "Send a task deliverable back to the assigned employee for revision. Use this when the output quality is insufficient, information is incomplete, or the deliverable does not meet requirements. The employee will receive your feedback and re-submit.",
      parameters: z.object({
        taskId: z
          .string()
          .describe(
            "The task ID (shown in the task list as taskId: `xxx`) whose deliverable needs revision"
          ),
        feedback: z
          .string()
          .describe(
            "Specific feedback for the employee: what is wrong, what to improve, what is missing. Be concrete so they can fix it."
          ),
      }),
    },
    {
      name: "approve_task",
      description:
        "Mark a task as completed. Only the CEO can decide when a task is done. Use this when the deliverable has been reviewed and meets your requirements. Do NOT approve if the employee has asked for clarification and you have not yet answered, or if quality is not satisfactory (use request_revision instead).",
      parameters: z.object({
        taskId: z
          .string()
          .describe(
            "The task ID (shown in the task list as taskId: `xxx`) to mark as completed"
          ),
        comment: z
          .string()
          .optional()
          .describe("Optional brief note for the record (e.g. what was approved)"),
      }),
    },
    {
      name: "request_info",
      description:
        "Ask a specific team member a question and get their response immediately, without creating a formal task.",
      parameters: z.object({
        roleName: z
          .enum(teamMembers as [string, ...string[]])
          .describe("The role of the team member to ask"),
        question: z.string().describe("The question to ask"),
      }),
    },
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// Agent Tool Definitions (for non-CEO agents)
// ════════════════════════════════════════════════════════════════════════════

function getAgentTools(): ToolDefinition[] {
  return [
    {
      name: "report_to_ceo",
      description:
        "Report your progress or results to the CEO. Use this when you've completed a task or have important updates. For documentation, PRDs, design specs, research reports — use this.",
      parameters: z.object({
        report: z
          .string()
          .describe(
            "Your report to the CEO, including results, findings, or progress updates"
          ),
      }),
    },
    {
      name: "save_to_workspace",
      description:
        "Save a file to your personal workspace (your folder in Document/Code tab). Use this frequently during work: save drafts, outlines, research notes, intermediate code, so your work is persisted and visible. Path is the directory in your workspace, e.g. 'docs', 'drafts', 'src', 'research'.",
      parameters: z.object({
        path: z
          .string()
          .describe(
            "Directory path in your workspace, e.g. docs, drafts, src, research (no leading/trailing slash)"
          ),
        title: z
          .string()
          .describe("Filename with extension, e.g. outline.md, notes.md"),
        content: z.string().describe("The file content"),
        fileType: z
          .enum(["document", "code"])
          .default("document")
          .describe("'document' for markdown/text, 'code' for source code"),
      }),
    },
    {
      name: "create_file",
      description:
        "Create and submit a file deliverable to the project. Use for final code (e.g. .tsx, .py) or docs. Optional path organizes files under your folder (e.g. path 'src' + title 'Button.tsx'). Save intermediate work with save_to_workspace instead.",
      parameters: z.object({
        title: z
          .string()
          .describe("Filename with extension, e.g. Button.tsx, api.py"),
        content: z.string().describe("The file content (source code or text)"),
        fileType: z
          .enum(["document", "code"])
          .default("code")
          .describe(
            "Use 'code' for source code (ts, tsx, py, etc.); use 'document' for markdown/docs"
          ),
        path: z
          .string()
          .optional()
          .describe(
            "Optional directory in your workspace, e.g. src, docs (no leading/trailing slash)"
          ),
      }),
    },
    {
      name: "ask_colleague",
      description:
        "Ask a question to a colleague in another role. Use this when you need information from another team member.",
      parameters: z.object({
        colleague_role: z
          .string()
          .describe(
            "The role of the colleague you want to ask (e.g., 'backend-dev', 'ui-designer')"
          ),
        question: z.string().describe("The question you want to ask"),
      }),
    },
  ];
}

export const projectWorkflow = new ProjectWorkflow();
