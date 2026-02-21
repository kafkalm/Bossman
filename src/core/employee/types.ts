/**
 * 员工逻辑模型：属性与提交任务入参。
 * 运行逻辑见 README（待办 → 分析规划 → 执行 → 汇报 → CEO 审核）。
 */

/** 员工在某一项目下的待办任务队列（按执行顺序） */
export type TodoQueue = readonly { taskId: string; title: string; status: string }[];

/** 员工当前正在执行的任务（同一时刻最多一个） */
export interface CurrentTask {
  taskId: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
}

/** 向指定员工待办队列提交任务时的入参 */
export interface SubmitTaskInput {
  projectId: string;
  employeeId: string;
  taskId: string;
}
