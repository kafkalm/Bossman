/**
 * CEO 单次运行周期：构建快照、提示、工具，调用 LLM，处理 tool calls。
 * 返回 shouldStop 与需要被调度的员工 ID（新分配或打回修改）。
 * 分支逻辑在代码中完成，按阶段选择对应 prompt 调用 LLM。
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { agentRuntime } from "@/core/agent/runtime";
import { messageBus } from "@/core/communication/message-bus";
import { employeeService } from "@/core/employee/service";
import { projectManager } from "@/core/project/manager";
import { loadProjectForCeo, type Project } from "@/core/project";
import { retryTaskExecution } from "./retry";
import type { ToolDefinition } from "@/core/llm/types";

export type CeoCycleResult = {
  shouldStop: boolean;
  runEmployeeIds: string[];
};

/** CEO 当前应处理的阶段，由代码分支决定用哪个 prompt */
export type CeoPhase =
  | "no_tasks"
  | "tasks_in_review"
  | "some_blocked"
  | "all_tasks_completed"
  | "doc_saved_ready_impl"
  | "has_active_work";

export function getCeoPhase(project: Project): CeoPhase {
  const tasks = project.tasks;
  const hasDocument = !!project.document?.trim();

  if (tasks.length === 0) return "no_tasks";

  const hasReview = tasks.some((t: { status: string }) => t.status === "review");
  if (hasReview) return "tasks_in_review";

  const hasBlocked = tasks.some((t: { status: string }) => t.status === "blocked");
  if (hasBlocked) return "some_blocked";

  const allCompleted = tasks.every((t: { status: string }) => t.status === "completed");
  if (allCompleted) return "all_tasks_completed";

  const allCompletedOrReviewOrBlocked = tasks.every((t: { status: string }) =>
    ["completed", "review", "blocked"].includes(t.status)
  );
  if (hasDocument && tasks.length > 0 && allCompletedOrReviewOrBlocked)
    return "doc_saved_ready_impl";

  return "has_active_work";
}

const CEO_RULES =
  "You MUST use tools to take action. Do not just describe — actually do it. Before assigning tasks, decide which roles are actually needed for this project and involve as few employees as necessary — do not assign to every role by default; prefer consolidating work onto fewer people when one role can cover it. In one response you can and should call assign_task multiple times to assign multiple subtasks to the minimal set of involved employees for parallel execution. Assign tasks using roleName (the role: in the team list). Only you decide when a task is done: use approve_task when satisfied, request_revision when not. When the project is ready for handover, set status to \"review\" (wait for Founder). Only the Founder can set the project to \"completed\" after acceptance.";

function buildPromptPreamble(
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  const desc = project.description ? `Project brief: ${project.description}\n` : "";
  return `You are the CEO managing the project **"${project.name}"**.
${desc}This is **management cycle ${iteration + 1}/${maxIterations}**.

Current state:

${snapshot}

---

${CEO_RULES}

`;
}

function buildPromptNoTasks(
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  return (
    buildPromptPreamble(project, snapshot, iteration, maxIterations) +
    `**Current phase: Project start — no tasks yet.**

First decide which roles are actually needed for this project (involve as few employees as possible). Consider scope and complexity: a small project may need only 1–2 roles (e.g. PM + one developer); only add more roles when the work clearly requires them. Then break the project into subtasks and call \`assign_task\` only for the roles you decided to involve — one or more tasks per involved role so they work concurrently. Prefer one person handling related work when their role fits (e.g. one developer for both frontend and backend on a tiny app). Start with the documentation phase. Take action now.`
  );
}

function buildPromptTasksInReview(
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  return (
    buildPromptPreamble(project, snapshot, iteration, maxIterations) +
    `**Current phase: Tasks in review or team has questions.**

Check Recent Messages first. If anyone asked for clarification, answer via \`send_message\` or get an answer via \`request_info\` and then send a summary. Do not \`approve_task\` until clarifications are addressed. For each task in review: if the deliverable is good, use \`approve_task\`; if not, use \`request_revision\` with concrete feedback. When all relevant deliverables are approved and questions answered, use \`save_project_document\` (doc phase) or move on.

Take action now.`
  );
}

function buildPromptDocSavedReadyImpl(
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  return (
    buildPromptPreamble(project, snapshot, iteration, maxIterations) +
    `**Current phase: Project document is saved; plan the implementation phase.**

Decide the minimal set of roles needed for implementation (involve as few employees as necessary). Then break the project into concrete implementation subtasks and call \`assign_task\` only for those roles — multiple tasks can go to the same role when appropriate (e.g. one developer for several related tickets). Assign in one response so involved engineers work concurrently.

Take action now.`
  );
}

function buildPromptAllTasksCompleted(
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  const lastCycle =
    iteration + 1 >= maxIterations
      ? ` This is your last cycle (${iteration + 1}/${maxIterations}); you MUST either set status to "review" or assign more tasks.`
      : "";
  return (
    buildPromptPreamble(project, snapshot, iteration, maxIterations) +
    `**Current phase: All tasks are completed.**

Analyze the Project Document and deliverables. If the project is not complete enough (missing scope, weak quality, or needs another iteration), decide the minimal set of roles needed for the next iteration, then call \`assign_task\` only for those roles so the team can work in parallel (involve as few employees as necessary). If the project is complete and ready for Founder acceptance, use \`update_project_status\` to set the project to "review" with a summary. Do NOT set status to "completed" — only the Founder can mark the project completed after acceptance.${lastCycle}

Take action now.`
  );
}

function buildPromptSomeBlocked(
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  return (
    buildPromptPreamble(project, snapshot, iteration, maxIterations) +
    `**Current phase: Some tasks are blocked or failed.**

Decide how to recover: reassign the work, adjust the plan, or ask a team member for clarification. Use \`send_message\`, \`request_info\`, or \`assign_task\` / \`request_revision\` as needed.

Take action now.`
  );
}

function buildPromptHasActiveWork(
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  return (
    buildPromptPreamble(project, snapshot, iteration, maxIterations) +
    `**Current phase: Some tasks are in progress, assigned, or pending.**

Review the state. If any tasks are in review, handle them (approve_task or request_revision). If you need to assign more work or unblock progress, involve only the minimal set of roles needed, then use the appropriate tools. Prefer calling \`assign_task\` multiple times in one response when adding several tasks.

Take action now.`
  );
}

export function buildPromptForPhase(
  phase: CeoPhase,
  project: Project,
  snapshot: string,
  iteration: number,
  maxIterations: number
): string {
  switch (phase) {
    case "no_tasks":
      return buildPromptNoTasks(project, snapshot, iteration, maxIterations);
    case "tasks_in_review":
      return buildPromptTasksInReview(project, snapshot, iteration, maxIterations);
    case "doc_saved_ready_impl":
      return buildPromptDocSavedReadyImpl(project, snapshot, iteration, maxIterations);
    case "all_tasks_completed":
      return buildPromptAllTasksCompleted(project, snapshot, iteration, maxIterations);
    case "some_blocked":
      return buildPromptSomeBlocked(project, snapshot, iteration, maxIterations);
    case "has_active_work":
      return buildPromptHasActiveWork(project, snapshot, iteration, maxIterations);
    default:
      return buildPromptHasActiveWork(project, snapshot, iteration, maxIterations);
  }
}

function buildFounderPrompt(founderMessage: string, snapshot: string): string {
  return `[Founder]: ${founderMessage}

---

${snapshot}

Respond to the Founder's message. If action is needed, use the appropriate tools. If the Founder asks you to resume work or compile a document, take the corresponding action.`;
}

export function buildCeoTools(
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
        "Create and assign one task to a team member. Only assign to roles you have already decided to involve (minimal set needed for the project). Call this tool multiple times to assign several subtasks to the involved employees for concurrent execution. Task types: documentation, implementation, review, research, design, testing, etc.",
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
        'Update the overall project status. Use "review" when the project is ready for Founder acceptance (do NOT use "completed" — only the Founder can mark the project completed after acceptance). Use "planning", "in_progress", "failed" as needed.',
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

/**
 * 处理 CEO 的 tool calls；不执行员工任务，只把需要被调度的员工 ID 放入 runEmployeeIds。
 * 若提供 onTaskAssigned（goroutine 模式），则每次分配/打回时回调，用于唤醒对应员工信箱。
 */
export async function processCeoToolCalls(
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
  }>,
  options?: {
    onTaskAssigned?: (employeeId: string, taskId: string) => void;
  }
): Promise<CeoCycleResult> {
  const runEmployeeIds: string[] = [];
  let shouldStop = false;
  const onTaskAssigned = options?.onTaskAssigned;

  for (const tc of toolCalls) {
    if (tc.name !== "assign_task") continue;
    const { roleName, taskTitle, taskDescription, priority } = tc.args as {
      roleName: string;
      taskTitle: string;
      taskDescription: string;
      priority?: number;
    };

    const employee = employees.find((e) => e.role.name === roleName);
    if (!employee) {
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
      status: "assigned",
    });

    await employeeService.submitTask({
      projectId,
      employeeId: employee.id,
      taskId: task.id,
    });

    await messageBus.send({
      projectId,
      taskId: task.id,
      senderType: "system",
      messageType: "task_assignment",
      content: `Task "${taskTitle}" has been assigned to ${employee.name} (${employee.role.title}).`,
      metadata: { taskId: task.id, employeeId: employee.id },
    });

    runEmployeeIds.push(employee.id);
    onTaskAssigned?.(employee.id, task.id);
  }

  for (const tc of toolCalls) {
    switch (tc.name) {
      case "assign_task":
        break;
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
        if (!revisionTask || revisionTask.projectId !== projectId) break;
        if (revisionTask.assignments.length === 0) break;
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
        runEmployeeIds.push(assignee.id);
        onTaskAssigned?.(assignee.id, revisionTaskId);
        break;
      }
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
        if (!approveTask || approveTask.projectId !== projectId) break;
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
      case "request_info": {
        const { roleName: infoRoleName, question } = tc.args as {
          roleName: string;
          question: string;
        };
        const infoEmployee = employees.find((e) => e.role.name === infoRoleName);
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
              content: `Request to ${infoEmployee!.name} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            });
          }
        }
        break;
      }
    }
  }

  return { shouldStop, runEmployeeIds };
}

export interface RunCeoCycleOptions {
  iteration: number;
  maxIterations: number;
  /** 若提供，则用 Founder 消息作为 prompt 而非迭代 prompt */
  founderMessage?: string;
  /** goroutine 模式：分配/打回任务时回调，用于唤醒员工信箱 */
  onTaskAssigned?: (employeeId: string, taskId: string) => void;
}

/**
 * CEO 单次运行：加载项目（含快照）、按阶段选 prompt，调用 LLM，处理 tool calls。
 */
export async function runCeoCycle(
  projectId: string,
  employees: Array<{
    id: string;
    name: string;
    role: { name: string; title: string };
  }>,
  options: RunCeoCycleOptions
): Promise<CeoCycleResult> {
  const ceo = employees.find((e) => e.role.name === "ceo");
  if (!ceo) {
    return { shouldStop: false, runEmployeeIds: [] };
  }

  const project = await loadProjectForCeo(projectId);
  const snapshot = await project.buildSnapshot();
  const tools = buildCeoTools(employees);

  const promptContent = options.founderMessage
    ? buildFounderPrompt(options.founderMessage, snapshot)
    : buildPromptForPhase(
        getCeoPhase(project),
        project,
        snapshot,
        options.iteration,
        options.maxIterations
      );

  const result = await agentRuntime.run({
    employeeId: ceo.id,
    projectId,
    tools,
    additionalMessages: [{ role: "user", content: promptContent }],
  });

  if (!result.toolCalls || result.toolCalls.length === 0) {
    return { shouldStop: false, runEmployeeIds: [] };
  }

  return processCeoToolCalls(projectId, employees, result.toolCalls, {
    onTaskAssigned: options.onTaskAssigned,
  });
}
