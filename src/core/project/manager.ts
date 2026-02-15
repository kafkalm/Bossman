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
        status: "planning",
      },
    });
  }

  /**
   * Get a project with all tasks and assignments.
   */
  async getProject(id: string) {
    return prisma.project.findUnique({
      where: { id },
      include: {
        tasks: {
          where: { parentId: null }, // only top-level tasks
          include: {
            assignments: {
              include: { employee: { include: { role: true } } },
            },
            subTasks: {
              include: {
                assignments: {
                  include: { employee: { include: { role: true } } },
                },
              },
            },
          },
          orderBy: { priority: "desc" },
        },
        company: {
          include: {
            employees: { include: { role: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            sender: { include: { role: true } },
          },
        },
      },
    });
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
   */
  async createTask(options: {
    projectId: string;
    title: string;
    description: string;
    parentId?: string;
    priority?: number;
  }) {
    return prisma.task.create({
      data: {
        projectId: options.projectId,
        title: options.title,
        description: options.description,
        parentId: options.parentId,
        priority: options.priority ?? 0,
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
      data: { status: "assigned" },
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
    return prisma.project.delete({ where: { id } });
  }
}

export const projectManager = new ProjectManager();
