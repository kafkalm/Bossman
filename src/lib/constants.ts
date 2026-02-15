export const APP_NAME = "Bossman";
export const APP_DESCRIPTION = "Build and manage your AI-powered company";

export const PROJECT_STATUSES = {
  planning: { label: "Planning", color: "bg-yellow-500" },
  in_progress: { label: "In Progress", color: "bg-blue-500" },
  review: { label: "Review", color: "bg-purple-500" },
  completed: { label: "Completed", color: "bg-green-500" },
  failed: { label: "Failed", color: "bg-red-500" },
} as const;

export const TASK_STATUSES = {
  pending: { label: "Pending", color: "bg-gray-400" },
  assigned: { label: "Assigned", color: "bg-yellow-500" },
  in_progress: { label: "In Progress", color: "bg-blue-500" },
  review: { label: "Review", color: "bg-purple-500" },
  completed: { label: "Completed", color: "bg-green-500" },
  blocked: { label: "Blocked", color: "bg-red-500" },
} as const;

export const EMPLOYEE_STATUSES = {
  idle: { label: "Idle", color: "bg-gray-400" },
  busy: { label: "Working", color: "bg-green-500" },
  offline: { label: "Offline", color: "bg-red-400" },
} as const;
