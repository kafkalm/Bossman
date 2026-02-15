export const APP_NAME = "Bossman";
export const APP_DESCRIPTION = "Build and manage your AI-powered company";

/** 项目状态及其颜色：规划=黄、进行中=蓝、审核=紫、已完成=绿、失败=红 */
export const PROJECT_STATUSES = {
  planning: { label: "Planning", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  review: { label: "Review", color: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-800" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  failed: { label: "Failed", color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800" },
} as const;

export function getProjectStatusColor(status: string): string {
  return PROJECT_STATUSES[status as keyof typeof PROJECT_STATUSES]?.color ?? "bg-muted text-muted-foreground border-border";
}

export const TASK_STATUSES = {
  pending: { label: "Pending", color: "bg-gray-400" },
  assigned: { label: "Assigned", color: "bg-yellow-500" },
  in_progress: { label: "In Progress", color: "bg-blue-500" },
  review: { label: "Review", color: "bg-purple-500" },
  completed: { label: "Completed", color: "bg-green-500" },
  blocked: { label: "Blocked", color: "bg-red-500" },
} as const;

/** 员工状态：空闲=绿，忙碌=橙，离线=红 */
export const EMPLOYEE_STATUSES = {
  idle: { label: "Idle", labelZh: "空闲", color: "bg-green-500" },
  busy: { label: "Working", labelZh: "忙碌中", color: "bg-orange-500" },
  offline: { label: "Offline", labelZh: "离线", color: "bg-red-400" },
} as const;

export function getEmployeeStatusColor(status: string): string {
  return EMPLOYEE_STATUSES[status as keyof typeof EMPLOYEE_STATUSES]?.color ?? "bg-gray-400";
}
