# 员工（Employee）模型与项目流程

**架构**：`Employee` 为抽象类，CEO 与普通员工是两种实现（`CeoEmployee` / `WorkerEmployee`）。调度器调用 `run()` 执行一次周期；goroutine 模式下收到待办通过唤醒信号 + `getTodoQueue` 取任务。

## 抽象类与实现

- **Employee（抽象类）**
  - 属性（概念）：待办任务队列、当前执行的任务（Worker 有，CEO 无）。
  - 方法：`receiveTask(taskId)`（向本员工提交任务）、`run(options)`（执行一次周期，抽象方法）。
- **CeoEmployee**：无待办队列；`run()` 内做分配与审核（`runCeoCycle`）；`receiveTask` 为 no-op。
- **WorkerEmployee**：`getTodoQueue()` / `getCurrentTask()` 来自 DB；`run()` 从队列取任务执行并汇报（`runWorkerCycle`）。

入口：`createEmployee(employeeId, projectId, roleName)` 按角色返回 `CeoEmployee` 或 `WorkerEmployee`；`runEmployee(projectId, employeeId, options)` 加载后调用 `run()`。

## 1. 员工属性（按角色）

| 属性 | 说明 | 存储/派生 |
|------|------|-----------|
| **待办任务队列** | 该员工在本项目中待处理的任务列表，按执行顺序排列 | 由 `TaskAssignment` + `Task.status in (assigned, in_progress)` 派生，可按 `assignedAt` 或后续 `queuePosition` 排序 |
| **当前执行的任务** | 正在执行中的任务，同一时刻最多一个 | `Task.status === 'in_progress'` 且 `assignments` 包含该员工 |

## 2. 员工方法

| 方法 | 说明 | 调用方 | 当前实现位置 |
|------|------|--------|--------------|
| **提交任务** | 向一名员工的待办队列里提交一个任务 | CEO、系统（打回后重新入队） | `ProjectManager.assignTask` / CEO 工具 `assign_task` |
| **分析规划任务** | 对任务进行拆解、规划，可产生子任务 | 员工自身（在「执行」中完成） | 在 `executeTask` 的 LLM 调用中，可由工具扩展 `create_subtask` |
| **执行任务** | 员工实际执行任务，包含任务状态与产出的更新 | 工作流调度 | `ProjectWorkflow.executeTask` |
| **汇报任务** | 确认完成，向 CEO 汇报（即把任务提交给 CEO 审核） | 员工自身 | 员工工具 `report_to_ceo`，任务置为 `review` |
| **审核任务** | CEO 独有；通过则任务完成，不通过则打回 | CEO | CEO 工具 `approve_task` / `request_revision` |

## 3. 员工运行逻辑（循环）

每个员工（含 CEO）的抽象循环：

1. **从待办队列取任务**：若当前没有「执行中」任务，则取队列中下一个（如按 `assignedAt` 或 `queuePosition`）。
2. **分析规划**：在本任务的执行过程中由 LLM 完成，可选地通过工具拆解子任务。
3. **执行任务**：调用 LLM + 工具，更新任务状态与产出。
4. **汇报任务**：通过 `report_to_ceo` 将任务置为 `review`，等待 CEO 审核。
5. **审核任务**（仅 CEO）：对 `review` 状态任务执行 `approve_task` 或 `request_revision`；打回时任务重新进入该员工的队列并再次执行。

非 CEO 员工：只做 2、3、4；CEO 在循环中还会对他人任务做 5，并对自己的「规划与分配」工作等价于 2、3、4。

## 4. 项目整体流程（Founder 创建项目后）

1. **CEO 拆解并分配**：根据项目描述拆解出大方向任务，通过「提交任务」分配给各专业员工。
2. **专业员工执行**：对收到的任务进行分析、规划、执行、汇报。
3. **CEO 审核**：对汇报上来的任务审核；不通过则打回，员工重新迭代。
4. **收尾**：确认所有任务完成或项目完成，等待 Founder 下一步指令；可继续上述步骤。

## 5. 实现对应

- **待办队列 / 当前任务**：`EmployeeService.getTodoQueue`、`getCurrentTask`。
- **提交任务**：`EmployeeService.submitTask`（CEO 在 `ceo-cycle.processCeoToolCalls` 里调用）。
- **执行 / 汇报**：`worker-cycle.runWorkerCycle` 从队列取任务，调用 `executeTaskForEmployee`（分析规划 + 执行 + report_to_ceo），任务进入 review。
- **审核**：CEO 在 `ceo-cycle` 中通过 `approve_task` / `request_revision` 处理；打回时将任务置为 in_progress 并把该员工加入 `runEmployeeIds`，由调度器再次调用该员工 `run()`。
- **充血模型与调度**：`Employee.run(projectId)` 执行一次周期（CEO 或员工）；`runEmployee(projectId, employeeId, options)` 为入口；`ProjectWorkflow.runProjectLoop` 每轮跑 CEO 再跑 `runEmployeeIds` 中的员工。

## 6. Goroutine 风格（可选）

TypeScript 没有真 goroutine，用「常驻 async 循环 + 唤醒信号」模拟；**待办列表与唤醒合二为一**：

- **待办列表**：唯一来源是 DB，即 `EmployeeService.getTodoQueue(employeeId, projectId)`。
- **WakeSignal**（`employee/mailbox.ts`）：仅做「有活可干」的唤醒，不携带 taskId。分配/打回时 `onTaskAssigned(employeeId)` 只调用 `wake.push()`。
- **员工循环**：`while (true) { await wake.next(); queue = getTodoQueue(...); if (queue.length === 0) continue; 执行 queue[0]; ceoTrigger.push('run'); }`。
- **CEO 循环**：仍用 `Mailbox<CeoTrigger>` 携带 `'run' | founder 消息`；分配时 `onTaskAssigned` 只负责唤醒对应员工，员工从 DB 取待办。

调度方式：`startProject` / `resumeProject` 调用 `launchProjectGoroutines(projectId)`；`founderMessage` 通过 `notifyFounderMessage(projectId, message)` 往 CEO 信箱投递。
