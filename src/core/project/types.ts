import { z } from "zod";

export const CreateProjectSchema = z.object({
  companyId: z.string(),
  name: z.string().min(1, "Project name is required"),
  description: z.string().max(200).optional().default(""),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export type ProjectStatus =
  | "active"
  | "review"
  | "done"
  | "blocked"
  | "canceled";

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "blocked"
  | "canceled";

export interface ProjectWithDetails {
  id: string;
  name: string;
  description: string;
  status: string;
  companyId: string;
  createdAt: Date;
  updatedAt: Date;
  tasks: TaskWithAssignments[];
}

export interface TaskWithAssignments {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  output: string | null;
  parentId: string | null;
  projectId: string;
  assignments: {
    employee: {
      id: string;
      name: string;
      role: { title: string };
    };
  }[];
  subTasks: TaskWithAssignments[];
}
