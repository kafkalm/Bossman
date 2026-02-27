export const APP_NAME = "Bossman";
export const APP_DESCRIPTION = "Build and manage your AI-powered company";

/** Project status color mapping. */
export const PROJECT_STATUSES = {
  active: { label: "Active", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  review: { label: "Review", color: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-800" },
  paused: { label: "Paused", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  done: { label: "Done", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  blocked: { label: "Blocked", color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800" },
  canceled: { label: "Canceled", color: "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800" },
  // Backward compatibility
  planning: { label: "Planning", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  failed: { label: "Failed", color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800" },
} as const;

export function getProjectStatusColor(status: string): string {
  return PROJECT_STATUSES[status as keyof typeof PROJECT_STATUSES]?.color ?? "bg-muted text-muted-foreground border-border";
}

export const TASK_STATUSES = {
  todo: { label: "Todo", color: "bg-gray-400" },
  in_progress: { label: "In Progress", color: "bg-blue-500" },
  review: { label: "Review", color: "bg-purple-500" },
  done: { label: "Done", color: "bg-green-500" },
  blocked: { label: "Blocked", color: "bg-red-500" },
  canceled: { label: "Canceled", color: "bg-zinc-500" },
  // Backward compatibility
  pending: { label: "Pending", color: "bg-gray-400" },
  assigned: { label: "Assigned", color: "bg-yellow-500" },
  completed: { label: "Completed", color: "bg-green-500" },
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
