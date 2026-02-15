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
          // CEO made no tool calls – it has nothing more to do.
          // If this is not the first iteration, the loop is done.
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

    for (const tc of toolCalls) {
      switch (tc.name) {
        // ── Assign Task ──
        case "assign_task": {
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

          // Execute the task immediately
          try {
            await this.executeTask(task.id);
          } catch (error) {
            console.error(`Task execution failed for ${task.id}:`, error);
            await projectManager.updateTaskStatus(task.id, "blocked");
            await messageBus.send({
              projectId,
              taskId: task.id,
              senderType: "system",
              messageType: "status_update",
              content: `Task "${taskTitle}" execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            });
          }
          break;
        }

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
            const infoResult = await agentRuntime.run({
              employeeId: infoEmployee.id,
              projectId,
              additionalMessages: [
                { role: "user", content: `[CEO asks]: ${question}` },
              ],
            });
            if (infoResult.content) {
              await messageBus.send({
                projectId,
                senderId: infoEmployee.id,
                senderType: "agent",
                messageType: "discussion",
                content: `[${infoEmployee.name} replies to CEO]: ${infoResult.content}`,
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

    if (result.toolCalls) {
      for (const tc of result.toolCalls) {
        if (tc.name === "report_to_ceo") {
          const { report } = tc.args as { report: string };
          await messageBus.send({
            projectId: task.projectId,
            taskId: task.id,
            senderId: employee.id,
            senderType: "agent",
            messageType: "deliverable",
            content: `[${employee.name} reports to CEO]: ${report}`,
          });
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
          `${emoji} **[${task.status.toUpperCase()}]** ${task.title} — assigned to ${who}`
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
    const blocked = project.tasks.filter(
      (t) => t.status === "blocked"
    ).length;
    const inProgress = project.tasks.filter(
      (t) => t.status === "in_progress"
    ).length;
    if (total > 0) {
      lines.push("");
      lines.push(
        `**Progress**: ${completed}/${total} completed, ${inProgress} in-progress, ${blocked} blocked`
      );
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

1. **If no tasks exist yet**: This is the start. Analyze the project, then use \`assign_task\` to delegate work to your team. Start with the **project initiation / documentation phase** — assign each relevant team member a documentation task based on their expertise:
   - **Product Manager**: Requirements analysis, feature scope, user stories, PRD
   - **UI Designer**: Design direction, key page layouts, interaction patterns
   - **Frontend Developer**: Frontend architecture, tech stack, component structure
   - **Backend Developer**: System architecture, API design, database schema
   - **QA Engineer**: Testing strategy, quality criteria, acceptance criteria
   - **Researcher**: Market research, competitive analysis, technical feasibility study
   - **Ideation Specialist**: Creative product ideas, innovation angles, feature brainstorming based on research
   Assign tasks only to team members that are relevant to this specific project.

2. **If documentation tasks are completed**: Review the outputs. If they look good, use \`save_project_document\` to compile all outputs into a comprehensive project document. Then move on to planning implementation tasks.

3. **If the project document is saved but no implementation tasks exist**: Plan the **implementation phase**. Break the project into concrete implementation tasks and assign them to the appropriate engineers and designers.

4. **If implementation tasks are completed**: Review the results. If there are issues or follow-ups needed, assign review/fix tasks. If everything looks satisfactory, use \`update_project_status\` to mark the project as **"completed"** with a summary.

5. **If some tasks are blocked or failed**: Decide how to recover — reassign the work, adjust the plan, or ask a team member for clarification.

**Important rules:**
- You MUST use tools to take action. Do not just describe what you would do — actually do it.
- Assign tasks to team members using their \`roleName\` (the \`role:\` value shown in the team list).
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
        "Report your progress or results to the CEO. Use this when you've completed a task or have important updates.",
      parameters: z.object({
        report: z
          .string()
          .describe(
            "Your report to the CEO, including results, findings, or progress updates"
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
