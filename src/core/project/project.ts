/**
 * Project 领域模型：内聚项目信息与快照构建，供 CEO cycle 等使用。
 */

import { prisma } from "@/lib/db";

/** 供 CEO 使用的项目数据结构（与 prisma project findUnique include 一致） */
export type ProjectForCeoData = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  document: string | null;
  companyId: string;
  company: {
    employees: Array<{
      id: string;
      name: string;
      role: { name: string; title: string };
    }>;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    output: string | null;
    assignments: Array<{
      employee: { name: string; role: { title: string } };
    }>;
  }>;
};

const projectForCeoInclude = {
  company: {
    include: { employees: { include: { role: true } } },
  },
  tasks: {
    include: {
      assignments: {
        include: { employee: { include: { role: true } } },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

/**
 * 带快照能力的项目模型，项目信息内聚在此。
 */
export class Project {
  constructor(readonly data: ProjectForCeoData) {}

  get id(): string {
    return this.data.id;
  }
  get name(): string {
    return this.data.name;
  }
  get description(): string | null {
    return this.data.description;
  }
  get status(): string {
    return this.data.status;
  }
  get document(): string | null {
    return this.data.document;
  }
  get companyId(): string {
    return this.data.companyId;
  }

  get tasks(): ProjectForCeoData["tasks"] {
    return this.data.tasks;
  }

  get company(): ProjectForCeoData["company"] {
    return this.data.company;
  }

  /** 构建当前项目快照（团队、文档状态、任务、进度、最近消息），供 CEO prompt 使用 */
  async buildSnapshot(): Promise<string> {
    const project = this.data;
    const projectId = project.id;
    const lines: string[] = [];

    lines.push("## Team Members");
    for (const emp of project.company.employees) {
      if (emp.role.name === "ceo") continue;
      lines.push(`- **${emp.name}** — ${emp.role.title} (role: \`${emp.role.name}\`)`);
    }

    lines.push("");
    lines.push(
      `## Project Document: ${project.document ? "✅ Saved" : "❌ Not yet compiled"}`
    );

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
          const truncated =
            task.output.length > 500
              ? task.output.slice(0, 500) + "\n... (truncated)"
              : task.output;
          lines.push(`  > Output:\n${truncated}`);
        }
      }
    }

    const total = project.tasks.length;
    const completed = project.tasks.filter((t: ProjectForCeoData["tasks"][number]) => t.status === "completed").length;
    const inReview = project.tasks.filter((t: ProjectForCeoData["tasks"][number]) => t.status === "review").length;
    const inProgress = project.tasks.filter((t: ProjectForCeoData["tasks"][number]) => t.status === "in_progress").length;
    const blocked = project.tasks.filter((t: ProjectForCeoData["tasks"][number]) => t.status === "blocked").length;
    if (total > 0) {
      lines.push("");
      lines.push(
        `**Progress**: ${completed}/${total} completed, ${inReview} in review, ${inProgress} in-progress, ${blocked} blocked`
      );
    }

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

/**
 * 加载供 CEO 使用的项目模型（含公司、员工、任务与分配）。
 */
export async function loadProjectForCeo(projectId: string): Promise<Project> {
  const data = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: projectForCeoInclude,
  });
  return new Project(data as unknown as ProjectForCeoData);
}
