/**
 * 员工（非 CEO）单次运行周期：从待办队列取一个任务，分析规划 + 执行 + 汇报。
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { agentRuntime } from "@/core/agent/runtime";
import { messageBus } from "@/core/communication/message-bus";
import { projectManager } from "@/core/project/manager";
import { sanitizeDocumentContent } from "@/lib/sanitize-document";
import { employeeService } from "@/core/employee/service";
import {
  writeWorkspaceFile,
  readWorkspaceFile,
  listWorkspaceFiles,
} from "@/core/workspace";
import { retryTaskExecution } from "./retry";
import type { ToolDefinition } from "@/core/llm/types";

export type WorkerCycleResult = {
  /** 是否执行了任务（队列非空并完成一次执行） */
  didWork: boolean;
  /** 执行后任务进入 review，应再跑 CEO */
  runCeo: boolean;
};

export function getAgentTools(): ToolDefinition[] {
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
        "Save a file to your personal workspace (your folder in Document/Code tab). Use this frequently during work: save drafts, outlines, research notes, intermediate code, so your work is persisted and visible. Files are stored under the current task folder automatically.",
      parameters: z.object({
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
        "Create and submit a file deliverable to the project. Use for final code (e.g. .tsx, .py) or docs. Save intermediate work with save_to_workspace instead. Files are stored under the current task folder automatically.",
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
      }),
    },
    {
      name: "list_workspace_files",
      description:
        "List files in the project workspace (.bossman_workspace/projectId/employeeId/). Returns relative paths you can pass to read_file.",
      parameters: z.object({}),
    },
    {
      name: "read_file",
      description:
        "Read a file from the project workspace. Use the relativePath returned by list_workspace_files (e.g. 'employeeId/docs/outline.md').",
      parameters: z.object({
        relativePath: z
          .string()
          .describe(
            "Path to the file relative to the project workspace, e.g. 'employeeId/docs/notes.md'"
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

/**
 * 执行单个任务：员工分析规划 + 执行 + 汇报（工具 report_to_ceo 等），任务状态更新为 review。
 */
export async function executeTaskForEmployee(taskId: string): Promise<void> {
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

  const result = await agentRuntime.run({
    employeeId: employee.id,
    projectId: task.projectId,
    taskId: task.id,
    tools: getAgentTools(),
  });

  let taskOutput: string | null = null;
  /** 是否调用了交付类工具（report_to_ceo / create_file / save_to_workspace）或用了 result.content 落盘；仅此时才进入 review */
  let hadDeliverableTool = false;

  const createFileAndShortMessage = async (
    content: string,
    title: string,
    fileType: "document" | "code" = "document",
    pathDir?: string | null
  ): Promise<string> => {
    const raw = typeof content === "string" ? content : "";
    const safeContent = sanitizeDocumentContent(raw);
    const brief =
      safeContent.length > 80
        ? safeContent.slice(0, 80).trim() + "…"
        : safeContent;
    let contentToStore = safeContent;
    try {
      await writeWorkspaceFile(
        task.projectId,
        employee.id,
        pathDir ?? null,
        title,
        safeContent
      );
      contentToStore = ""; // 不把内容存 DB，已写入 .bossman_workspace
    } catch {
      // 写入工作区失败时仍落 DB，保证不丢
    }
    const file = await prisma.projectFile.create({
      data: {
        projectId: task.projectId,
        employeeId: employee.id,
        taskId: task.id,
        title,
        path: pathDir ?? null,
        content: contentToStore,
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
        hadDeliverableTool = true;
        const { report } = tc.args as { report?: string };
        const reportContent = typeof report === "string" ? report : "";
        reports.push(reportContent);
        await createFileAndShortMessage(reportContent, task.title, "document", task.id);
      } else if (tc.name === "create_file" || tc.name === "save_to_workspace") {
        hadDeliverableTool = true;
        const args = tc.args as {
          title?: string;
          content?: string;
          fileType?: "document" | "code";
        };
        const title = args.title ?? "untitled";
        const content = sanitizeDocumentContent(args.content ?? "");
        const fileType =
          args.fileType ?? (tc.name === "save_to_workspace" ? "document" : "code");
        // 路径由代码指定：按任务 ID 存到 .bossman_workspace/{projectId}/{employeeId}/{taskId}/{title}
        await createFileAndShortMessage(content, title, fileType, task.id);
        reports.push(
          `[${employee.name}] 已保存${fileType === "code" ? "代码" : "文档"} → ${title}`
        );
      } else if (tc.name === "list_workspace_files") {
        const list = await listWorkspaceFiles(task.projectId);
        const summary =
          list.length === 0
            ? "No files in workspace."
            : list
                .map(
                  (f) =>
                    `${f.relativePath} (${f.employeeId}: ${f.pathDir ? f.pathDir + "/" : ""}${f.title})`
                )
                .join("\n");
        reports.push(`[Workspace files]\n${summary}`);
      } else if (tc.name === "read_file") {
        const args = tc.args as { relativePath?: string };
        const relativePath = args.relativePath ?? "";
        const content = await readWorkspaceFile(task.projectId, relativePath);
        if (content != null) {
          reports.push(`[Read file: ${relativePath}]\n${content}`);
        } else {
          reports.push(`[Read file: ${relativePath}] (not found or unreadable)`);
        }
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
    taskOutput = sanitizeDocumentContent(result.content);
    await createFileAndShortMessage(taskOutput, task.title, "document", task.id);
    hadDeliverableTool = true;
  }

  // 有交付 → review；无交付 → 保持 assigned，留在队列让员工再次执行并真正交付
  const statusToSet =
    taskOutput != null && taskOutput !== "" && hadDeliverableTool ? "review" : "assigned";
  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: statusToSet,
      ...(taskOutput != null && taskOutput !== "" && hadDeliverableTool ? { output: taskOutput } : {}),
    },
  });
}

/**
 * 员工单次运行：从待办队列取第一个任务并执行；无任务则直接返回。
 * 执行失败时重试，仍失败则将任务标为 blocked 并发送系统消息。
 */
export async function runWorkerCycle(
  projectId: string,
  employeeId: string
): Promise<WorkerCycleResult> {
  const queue = await employeeService.getTodoQueue(employeeId, projectId);
  if (queue.length === 0) {
    return { didWork: false, runCeo: false };
  }

  const first = queue[0];
  const firstTaskId = first.taskId;
  const taskTitle = first.title;

  try {
    await retryTaskExecution(
      () => executeTaskForEmployee(firstTaskId),
      (attempt) => {
        messageBus
          .send({
            projectId,
            taskId: firstTaskId,
            senderType: "system",
            messageType: "status_update",
            content: `Task "${taskTitle}" failed (attempt ${attempt}/3), retrying...`,
          })
          .catch(() => {});
      }
    );
  } catch (error) {
    await projectManager.updateTaskStatus(firstTaskId, "blocked");
    await messageBus.send({
      projectId,
      taskId: firstTaskId,
      senderType: "system",
      messageType: "status_update",
      content: `Task "${taskTitle}" execution failed after 3 attempts: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }

  return { didWork: true, runCeo: true };
}
