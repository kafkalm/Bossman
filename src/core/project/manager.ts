import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CreateProjectInput } from "./types";

/**
 * ProjectManager handles project CRUD and task management.
 */
export class ProjectManager {
  /**
   * Create a new project.
   */
  async createProject(input: CreateProjectInput) {
    return prisma.project.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        description: input.description,
        status: "active",
      },
    });
  }

  /**
   * Get a project with all tasks and assignments.
   */
  async getProject(id: string) {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        company: {
          include: {
            employees: {
              include: {
                role: { select: { id: true, name: true, title: true } },
              },
            },
          },
        },
      },
    });
    if (!project) return null;

    const [tasks, messages] = await Promise.all([
      prisma.task
        .findMany({
          where: { projectId: id, parentId: null },
          include: {
            assignments: {
              include: {
                employee: {
                  include: {
                    role: { select: { id: true, name: true, title: true } },
                  },
                },
              },
            },
            subTasks: {
              include: {
                assignments: {
                  include: {
                    employee: {
                      include: {
                        role: { select: { id: true, name: true, title: true } },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { priority: "desc" },
        })
        .catch((error) => {
          console.warn("[ProjectManager.getProject] tasks query failed, fallback to empty list:", error);
          return [];
        }),
      prisma.message
        .findMany({
          where: { projectId: id },
          orderBy: { createdAt: "asc" },
          include: {
            sender: {
              include: {
                role: { select: { id: true, name: true, title: true } },
              },
            },
          },
        })
        .catch((error) => {
          console.warn("[ProjectManager.getProject] messages query failed, fallback to empty list:", error);
          return [];
        }),
    ]);

    return {
      ...project,
      tasks,
      messages,
      files: [],
    };
  }

  /**
   * List all projects for a company.
   */
  async listProjects(companyId?: string) {
    return prisma.project.findMany({
      where: companyId ? { companyId } : {},
      include: {
        company: true,
        _count: { select: { tasks: true, messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Update project status.
   */
  async updateStatus(projectId: string, status: string) {
    return prisma.project.update({
      where: { id: projectId },
      data: { status },
    });
  }

  /**
   * Create a task for a project.
   * When creating and immediately assigning (e.g. CEO assign_task), pass status: "in_progress"
   * so the task never appears as "todo".
   */
  async createTask(options: {
    projectId: string;
    title: string;
    description: string;
    parentId?: string;
    priority?: number;
    status?: string;
  }) {
    return prisma.task.create({
      data: {
        projectId: options.projectId,
        title: options.title,
        description: options.description,
        parentId: options.parentId,
        priority: options.priority ?? 0,
        status: options.status ?? "todo",
      },
    });
  }

  /**
   * Assign a task to an employee.
   */
  async assignTask(taskId: string, employeeId: string) {
    // Update task status
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "in_progress" },
    });

    // Create assignment
    return prisma.taskAssignment.create({
      data: {
        taskId,
        employeeId,
      },
      include: {
        task: true,
        employee: { include: { role: true } },
      },
    });
  }

  /**
   * Update task status.
   */
  async updateTaskStatus(taskId: string, status: string) {
    return prisma.task.update({
      where: { id: taskId },
      data: { status },
    });
  }

  /**
   * Update task output (deliverable).
   */
  async updateTaskOutput(taskId: string, output: string) {
    return prisma.task.update({
      where: { id: taskId },
      data: { output },
    });
  }

  /**
   * Get all tasks for a project (flat list).
   */
  async getProjectTasks(projectId: string) {
    return prisma.task.findMany({
      where: { projectId },
      include: {
        assignments: {
          include: { employee: { include: { role: true } } },
        },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  /**
   * Delete a project.
   */
  async deleteProject(id: string) {
    const result = await prisma.$transaction(async (tx) => {
      const exists = await tx.project.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) {
        return { deleted: false };
      }

      // Use raw SQL cleanup to tolerate schema drift between runtime DB and generated Prisma delegates.
      await safeProjectDelete(tx, `DELETE FROM "EmployeeInbox" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "ConversationMessage" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "ConversationThread" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "EngineTimelineEvent" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "TaskTransition" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "ProjectTransition" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "ProjectFile" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "Message" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "TokenUsage" WHERE "projectId" = ?`, id);
      await safeProjectDelete(
        tx,
        `DELETE FROM "TaskAssignment" WHERE "taskId" IN (SELECT "id" FROM "Task" WHERE "projectId" = ?)`,
        id
      );
      await safeProjectDelete(tx, `DELETE FROM "Task" WHERE "projectId" = ? AND "parentId" IS NOT NULL`, id);
      await safeProjectDelete(tx, `DELETE FROM "Task" WHERE "projectId" = ?`, id);
      await safeProjectDelete(tx, `DELETE FROM "Project" WHERE "id" = ?`, id);

      return { deleted: true };
    });

    if (!result.deleted) {
      throw new Error("Project not found");
    }
    return result;
  }
}

export const projectManager = new ProjectManager();

async function safeProjectDelete(
  tx: Prisma.TransactionClient,
  sql: string,
  projectId: string
) {
  try {
    await tx.$executeRawUnsafe(sql, projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("no such table")) {
      return;
    }
    throw error;
  }
}
