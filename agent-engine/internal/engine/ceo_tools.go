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

		task, err := c.svc.db.CreateTask(ctx, projectID, taskTitle, taskDescription, priority)
		if err != nil {
			return nil, fmt.Errorf("create task: %w", err)
		}
		validateTaskTransitionOrWarn(TaskStatusPending, TaskStatusAssigned, task.ID)
		if err := c.svc.db.AssignTask(ctx, task.ID, emp.ID); err != nil {
			return nil, fmt.Errorf("assign task: %w", err)
		}
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
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
				"📄 Project document has been compiled and saved. You can view it in the Document tab.")
			cycleResult.SavedDocument = true

		case "update_project_status":
			status, _ := tc.Args["status"].(string)
			summary, _ := tc.Args["summary"].(string)
			validateProjectTransitionOrWarn(project.Status, status, projectID)
			if err := c.svc.db.UpdateProjectStatus(ctx, projectID, status); err != nil {
				return nil, fmt.Errorf("update status: %w", err)
			}
			project.Status = status
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
				fmt.Sprintf("Project status updated to **%s**: %s", status, summary))
			if status == ProjectStatusCompleted || status == ProjectStatusFailed {
				cycleResult.ShouldStop = true
			}

		case "send_message":
			content, _ := tc.Args["content"].(string)
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil, "[CEO] "+content)

		case "request_revision":
			taskID, _ := tc.Args["taskId"].(string)
			feedback, _ := tc.Args["feedback"].(string)
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID || task.AssigneeID == nil {
				break
			}
			validateTaskTransitionOrWarn(task.Status, TaskStatusInProgress, taskID)
			if err := c.svc.db.ClearTaskOutput(ctx, taskID); err != nil {
				return nil, fmt.Errorf("clear task output: %w", err)
			}
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &taskID,
				fmt.Sprintf("[CEO 要求修改] %s 的《%s》质量不达标，需根据反馈重新编写。", strOrEmpty(task.AssigneeName), task.Title))
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &taskID,
				"[CEO 反馈 - 请按要求修改后重新提交]\n\n"+feedback)
			cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, *task.AssigneeID)
			runState.WakeWorker(*task.AssigneeID)

		case "approve_task":
			taskID, _ := tc.Args["taskId"].(string)
			comment, _ := tc.Args["comment"].(string)
			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID {
				break
			}
			validateTaskTransitionOrWarn(task.Status, TaskStatusCompleted, taskID)
			if err := c.svc.db.UpdateTaskStatus(ctx, taskID, TaskStatusCompleted); err != nil {
				return nil, fmt.Errorf("approve task: %w", err)
			}
			who := strOrEmpty(task.AssigneeName)
			msg := fmt.Sprintf("[CEO 已通过] %s（%s）交付已确认。", task.Title, who)
			if comment != "" {
				msg = fmt.Sprintf("[CEO 已通过] %s（%s）- %s", task.Title, who, comment)
			}
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &taskID, msg)
			cycleResult.ApprovedCount++

		case "request_info":
			roleName, _ := tc.Args["roleName"].(string)
			question, _ := tc.Args["question"].(string)
			emp := findEmployeeByRole(employees, roleName)
			if emp == nil {
				break
			}

			err := retryWithBackoff(ctx, func() error {
				infoResult, err := c.svc.Run(ctx, RunOptions{
					Employee: emp,
					Project:  project,
					AdditionalMessages: []llm.ChatMessage{
						{Role: "user", Content: fmt.Sprintf("[CEO asks]: %s", question)},
					},
				})
				if err != nil || infoResult.Content == "" {
					return err
				}

				const docThreshold = 150
				looksLikeDoc := len(infoResult.Content) > docThreshold || containsMarkdownHeaders(infoResult.Content)
				if looksLikeDoc {
					brief := infoResult.Content
					if len(brief) > 80 {
						brief = brief[:80] + "…"
					}
					title := question
					if len(title) > 40 {
						title = title[:40] + "…"
					}
					file, err := c.svc.db.CreateProjectFile(ctx,
						projectID, emp.ID, nil,
						fmt.Sprintf("%s 回复：%s", emp.Name, title),
						nil, infoResult.Content, brief, "document",
					)
					if err != nil {
						return err
					}
					senderID := emp.ID
					_ = sendAgentMsg(ctx, c.svc.db, c.svc.bus, projectID, nil, &senderID,
						fmt.Sprintf("[%s replies to CEO] %s -> 查看文档", emp.Name, brief),
						map[string]interface{}{"fileId": file.ID, "brief": brief, "fileType": "document"})
				} else {
					senderID := emp.ID
					_ = sendAgentMsg(ctx, c.svc.db, c.svc.bus, projectID, nil, &senderID,
						fmt.Sprintf("[%s replies to CEO]: %s", emp.Name, infoResult.Content), nil)
				}
				return nil
			}, func(attempt int, err error) {
				_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
					fmt.Sprintf("request_info from %s failed (attempt %d/3), retrying...", roleName, attempt))
			})
			if err != nil {
				_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
					fmt.Sprintf("Request to %s failed: %v", emp.Name, err))
			}
		}
	}

	return cycleResult, nil
}
