package engine

import (
	"context"
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

// processToolCalls handles all CEO tool invocations.
func (c *CEO) processToolCalls(
	ctx context.Context,
	runState ProjectRunState,
	project *db.Project,
	employees []db.EmployeeWithRole,
	toolCalls []llm.ToolCall,
) (*CeoCycleResult, error) {
	cycleResult := &CeoCycleResult{}
	projectID := runState.ProjectID()

	for _, tc := range toolCalls {
		if tc.Name != "assign_task" {
			continue
		}
		roleName, _ := tc.Args["roleName"].(string)
		existingTaskID, _ := tc.Args["taskId"].(string)
		taskTitle, _ := tc.Args["taskTitle"].(string)
		taskDescription, _ := tc.Args["taskDescription"].(string)
		priority := 5
		if p, ok := tc.Args["priority"].(float64); ok {
			priority = int(p)
		}

		emp := findEmployeeByRole(employees, roleName)
		if emp == nil {
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
				fmt.Sprintf("⚠️ Could not assign task \"%s\" - no employee with role \"%s\" found.", taskTitle, roleName))
			continue
		}

		if existingTaskID != "" {
			existingTask, err := c.svc.db.GetTask(ctx, existingTaskID)
			if err != nil || existingTask.Task.ProjectID != projectID {
				_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
					fmt.Sprintf("⚠️ Could not reschedule task `%s` - task not found in project.", existingTaskID))
				continue
			}
			status := normalizeTaskStatus(existingTask.Status)
			if status == TaskStatusDone || status == TaskStatusCanceled {
				_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &existingTaskID,
					fmt.Sprintf("⚠️ Task `%s` is terminal (%s) and cannot be rescheduled directly. Create a new task.", existingTaskID, status))
				continue
			}
			if err := c.svc.db.ReassignTask(ctx, existingTaskID, emp.ID); err != nil {
				return nil, fmt.Errorf("reassign task: %w", err)
			}
			if err := c.svc.TransitionTaskStatus(ctx, existingTaskID, TaskStatusTodo, "rescheduled by ceo", "ceo"); err != nil {
				return nil, fmt.Errorf("reschedule transition: %w", err)
			}
			if err := c.svc.db.ClearTaskOutput(ctx, existingTaskID); err != nil {
				return nil, fmt.Errorf("clear task output: %w", err)
			}
			_ = c.svc.db.AddTimelineEvent(ctx, projectID, &existingTaskID, "task.updated", "ceo",
				fmt.Sprintf("task rescheduled to %s (%s)", emp.Name, emp.RoleName),
				map[string]interface{}{"taskId": existingTaskID, "employeeId": emp.ID, "priority": priority})
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &existingTaskID,
				fmt.Sprintf("Task \"%s\" has been rescheduled to %s (%s).", existingTask.Title, emp.Name, emp.RoleTitle),
				map[string]interface{}{"taskId": existingTaskID, "employeeId": emp.ID, "rescheduled": true})
			cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, emp.ID)
			runState.WakeWorker(emp.ID)
			continue
		}

		task, err := c.svc.db.CreateTask(ctx, projectID, taskTitle, taskDescription, priority)
		if err != nil {
			return nil, fmt.Errorf("create task: %w", err)
		}
		if err := c.svc.db.AssignTask(ctx, task.ID, emp.ID); err != nil {
			return nil, fmt.Errorf("assign task: %w", err)
		}
		_ = c.svc.db.AddTimelineEvent(ctx, projectID, &task.ID, "task.updated", "ceo",
			fmt.Sprintf("task created and assigned to %s (%s)", emp.Name, emp.RoleName),
			map[string]interface{}{"taskId": task.ID, "employeeId": emp.ID, "priority": priority})
		_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &task.ID,
			fmt.Sprintf("Task \"%s\" has been assigned to %s (%s).", taskTitle, emp.Name, emp.RoleTitle),
			map[string]interface{}{"taskId": task.ID, "employeeId": emp.ID})

		cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, emp.ID)
		runState.WakeWorker(emp.ID)
	}

	for _, tc := range toolCalls {
		switch tc.Name {
		case "assign_task":
		case "save_project_document":
			document, _ := tc.Args["document"].(string)
			if err := c.svc.db.UpdateProjectDocument(ctx, projectID, document); err != nil {
				return nil, fmt.Errorf("save document: %w", err)
			}
			_ = c.svc.db.AddTimelineEvent(ctx, projectID, nil, "project.updated", "ceo", "project document updated", nil)
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
				"📄 Project document has been compiled and saved. You can view it in the Document tab.")
			cycleResult.SavedDocument = true

		case "update_project_status":
			status, _ := tc.Args["status"].(string)
			summary, _ := tc.Args["summary"].(string)
			if err := c.svc.TransitionProjectStatus(ctx, projectID, status, summary, "ceo"); err != nil {
				return nil, fmt.Errorf("update status: %w", err)
			}
			project.Status = normalizeProjectStatus(status)
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
				fmt.Sprintf("Project status updated to **%s**: %s", status, summary))
			if status == ProjectStatusDone || status == ProjectStatusBlocked || status == ProjectStatusCanceled {
				cycleResult.ShouldStop = true
			}

		case "request_revision":
			taskID, _ := tc.Args["taskId"].(string)
			feedback, _ := tc.Args["feedback"].(string)
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID || task.AssigneeID == nil {
				break
			}
			newDescription := task.Description + "\n\n[Revision Requested]\n" + feedback
			if err := c.svc.db.UpdateTaskDetails(ctx, taskID, task.Title, newDescription, task.Priority); err != nil {
				return nil, fmt.Errorf("update revision task details: %w", err)
			}
			if err := c.svc.TransitionTaskStatus(ctx, taskID, TaskStatusTodo, "revision requested by ceo", "ceo"); err != nil {
				return nil, fmt.Errorf("request revision transition: %w", err)
			}
			if err := c.svc.db.ClearTaskOutput(ctx, taskID); err != nil {
				return nil, fmt.Errorf("clear task output: %w", err)
			}
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &taskID, fmt.Sprintf("[Task Updated For Revision] %s", task.Title))
			cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, *task.AssigneeID)
			runState.WakeWorker(*task.AssigneeID)

		case "update_task":
			taskID, _ := tc.Args["taskId"].(string)
			reason, _ := tc.Args["reason"].(string)
			taskTitle, _ := tc.Args["taskTitle"].(string)
			taskDescription, _ := tc.Args["taskDescription"].(string)
			priority := -1
			if p, ok := tc.Args["priority"].(float64); ok {
				priority = int(p)
			}
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID {
				break
			}
			title := task.Title
			if taskTitle != "" {
				title = taskTitle
			}
			description := task.Description
			if taskDescription != "" {
				description = taskDescription
			}
			nextPriority := task.Priority
			if priority >= 0 {
				nextPriority = priority
			}
			if err := c.svc.db.UpdateTaskDetails(ctx, taskID, title, description, nextPriority); err != nil {
				return nil, fmt.Errorf("update task details: %w", err)
			}
			if err := c.svc.db.ClearTaskOutput(ctx, taskID); err != nil {
				return nil, fmt.Errorf("clear task output: %w", err)
			}
			if err := c.svc.TransitionTaskStatus(ctx, taskID, TaskStatusTodo, reason, "ceo"); err != nil {
				return nil, fmt.Errorf("update task transition: %w", err)
			}
			if task.AssigneeID != nil {
				cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, *task.AssigneeID)
				runState.WakeWorker(*task.AssigneeID)
			}

		case "reassign_task":
			taskID, _ := tc.Args["taskId"].(string)
			roleName, _ := tc.Args["roleName"].(string)
			reason, _ := tc.Args["reason"].(string)
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID {
				break
			}
			emp := findEmployeeByRole(employees, roleName)
			if emp == nil {
				break
			}
			if err := c.svc.db.ReassignTask(ctx, taskID, emp.ID); err != nil {
				return nil, fmt.Errorf("reassign task: %w", err)
			}
			if err := c.svc.db.ClearTaskOutput(ctx, taskID); err != nil {
				return nil, fmt.Errorf("clear task output: %w", err)
			}
			if err := c.svc.TransitionTaskStatus(ctx, taskID, TaskStatusTodo, reason, "ceo"); err != nil {
				return nil, fmt.Errorf("reassign task transition: %w", err)
			}
			cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, emp.ID)
			runState.WakeWorker(emp.ID)

		case "unblock_task":
			taskID, _ := tc.Args["taskId"].(string)
			reason, _ := tc.Args["reason"].(string)
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID {
				break
			}
			if err := c.svc.TransitionTaskStatus(ctx, taskID, TaskStatusTodo, reason, "ceo"); err != nil {
				return nil, fmt.Errorf("unblock task: %w", err)
			}
			if task.AssigneeID != nil {
				cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, *task.AssigneeID)
				runState.WakeWorker(*task.AssigneeID)
			}

		case "approve_task":
			taskID, _ := tc.Args["taskId"].(string)
			comment, _ := tc.Args["comment"].(string)
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID {
				break
			}
			if err := c.svc.TransitionTaskStatus(ctx, taskID, TaskStatusDone, "approved by ceo", "ceo"); err != nil {
				return nil, fmt.Errorf("approve task: %w", err)
			}
			who := strOrEmpty(task.AssigneeName)
			msg := fmt.Sprintf("[CEO 已通过] %s（%s）交付已确认。", task.Title, who)
			if comment != "" {
				msg = fmt.Sprintf("[CEO 已通过] %s（%s）- %s", task.Title, who, comment)
			}
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &taskID, msg)
			cycleResult.ApprovedCount++

		case "block_task":
			taskID, _ := tc.Args["taskId"].(string)
			reason, _ := tc.Args["reason"].(string)
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID {
				break
			}
			if err := c.svc.TransitionTaskStatus(ctx, taskID, TaskStatusBlocked, reason, "ceo"); err != nil {
				return nil, fmt.Errorf("block task: %w", err)
			}
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &taskID,
				fmt.Sprintf("[CEO blocked] %s: %s", task.Title, reason))
		}
	}

	return cycleResult, nil
}
