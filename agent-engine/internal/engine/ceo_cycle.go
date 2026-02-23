package engine

import (
	"context"
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/agent"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/engine/tools"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

// CeoCycleResult is the result of a single CEO cycle
type CeoCycleResult struct {
	ShouldStop          bool
	AssignedEmployeeIDs []string
	ApprovedCount       int
	SavedDocument       bool
}

// RunCeoCycle executes one CEO management cycle:
// load project → build snapshot → select phase → call LLM → process tool calls
func RunCeoCycle(ctx context.Context, deps *Deps, run *ProjectRun, iteration, maxIterations int, founderMessage string) (*CeoCycleResult, error) {
	// Load project
	project, err := deps.DB.GetProject(ctx, run.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}

	// Load employees
	employees, err := deps.DB.GetProjectEmployees(ctx, run.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("load employees: %w", err)
	}

	ceo := findEmployeeByRole(employees, "ceo")
	if ceo == nil {
		return &CeoCycleResult{}, nil
	}

	// Load tasks
	tasks, err := deps.DB.GetTasksForProject(ctx, run.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("load tasks: %w", err)
	}

	// Build snapshot
	snapshot, err := buildProjectSnapshot(ctx, deps, project, tasks, employees)
	if err != nil {
		return nil, fmt.Errorf("build snapshot: %w", err)
	}

	// Determine phase and build prompt
	var promptContent string
	if founderMessage != "" {
		promptContent = BuildFounderPrompt(founderMessage, snapshot)
	} else {
		phase := GetCeoPhase(project, tasks)
		// Smart skip: if has_active_work and all tasks are purely waiting, skip LLM call
		if phase == PhaseHasActiveWork && AllTasksActiveOrInProgress(tasks) && founderMessage == "" {
			return &CeoCycleResult{}, nil
		}
		promptContent = BuildPromptForPhase(phase, project, snapshot, iteration, maxIterations)
	}

	// Build team roles for CEO tools
	var teamRoles []string
	for _, emp := range employees {
		if emp.RoleName != "ceo" {
			teamRoles = append(teamRoles, emp.RoleName)
		}
	}

	ceoTools := tools.BuildCeoTools(teamRoles)

	// Call LLM
	result, err := deps.Runtime.Run(ctx, agent.RunOptions{
		EmployeeID:         ceo.ID,
		ProjectID:          run.ProjectID,
		Tools:              ceoTools,
		AdditionalMessages: []llm.ChatMessage{{Role: "user", Content: promptContent}},
	})
	if err != nil {
		return nil, fmt.Errorf("CEO LLM call: %w", err)
	}

	if len(result.ToolCalls) == 0 {
		return &CeoCycleResult{}, nil
	}

	return processCeoToolCalls(ctx, deps, run, project, employees, result.ToolCalls)
}

// processCeoToolCalls handles all CEO tool invocations
func processCeoToolCalls(
	ctx context.Context,
	deps *Deps,
	run *ProjectRun,
	project *db.Project,
	employees []db.EmployeeWithRole,
	toolCalls []llm.ToolCall,
) (*CeoCycleResult, error) {
	cycleResult := &CeoCycleResult{}

	// Process assign_task first (so workers can be woken immediately)
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
			_ = sendSystemMsg(ctx, deps, run.ProjectID, nil,
				fmt.Sprintf("⚠️ Could not assign task \"%s\" — no employee with role \"%s\" found.", taskTitle, roleName))
			continue
		}

		task, err := deps.DB.CreateTask(ctx, run.ProjectID, taskTitle, taskDescription, priority)
		if err != nil {
			return nil, fmt.Errorf("create task: %w", err)
		}

		if err := deps.DB.AssignTask(ctx, task.ID, emp.ID); err != nil {
			return nil, fmt.Errorf("assign task: %w", err)
		}

		_ = sendSystemMsg(ctx, deps, run.ProjectID, &task.ID,
			fmt.Sprintf("Task \"%s\" has been assigned to %s (%s).", taskTitle, emp.Name, emp.RoleTitle),
			map[string]interface{}{"taskId": task.ID, "employeeId": emp.ID})

		cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, emp.ID)

		// Wake the worker goroutine
		run.mu.RLock()
		wake, ok := run.WakeSignals[emp.ID]
		run.mu.RUnlock()
		if ok {
			select {
			case wake <- struct{}{}:
			default:
			}
		}
	}

	// Process remaining tools
	for _, tc := range toolCalls {
		switch tc.Name {
		case "assign_task":
			// Already handled above

		case "save_project_document":
			document, _ := tc.Args["document"].(string)
			if err := deps.DB.UpdateProjectDocument(ctx, run.ProjectID, document); err != nil {
				return nil, fmt.Errorf("save document: %w", err)
			}
			_ = sendSystemMsg(ctx, deps, run.ProjectID, nil,
				"📄 Project document has been compiled and saved. You can view it in the Document tab.")
			cycleResult.SavedDocument = true

		case "update_project_status":
			status, _ := tc.Args["status"].(string)
			summary, _ := tc.Args["summary"].(string)
			if err := deps.DB.UpdateProjectStatus(ctx, run.ProjectID, status); err != nil {
				return nil, fmt.Errorf("update status: %w", err)
			}
			_ = sendSystemMsg(ctx, deps, run.ProjectID, nil,
				fmt.Sprintf("Project status updated to **%s**: %s", status, summary))
			if status == "completed" || status == "failed" {
				cycleResult.ShouldStop = true
			}

		case "send_message":
			content, _ := tc.Args["content"].(string)
			_ = sendSystemMsg(ctx, deps, run.ProjectID, nil, "[CEO] "+content)

		case "request_revision":
			taskID, _ := tc.Args["taskId"].(string)
			feedback, _ := tc.Args["feedback"].(string)

			task, err := deps.DB.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != run.ProjectID {
				break
			}
			if task.AssigneeID == nil {
				break
			}

			if err := deps.DB.ClearTaskOutput(ctx, taskID); err != nil {
				return nil, fmt.Errorf("clear task output: %w", err)
			}

			_ = sendSystemMsg(ctx, deps, run.ProjectID, &taskID,
				fmt.Sprintf("[CEO 要求修改] %s 的《%s》质量不达标，需根据反馈重新编写。",
					strOrEmpty(task.AssigneeName), task.Title))
			_ = sendSystemMsg(ctx, deps, run.ProjectID, &taskID,
				"[CEO 反馈 - 请按要求修改后重新提交]\n\n"+feedback)

			cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, *task.AssigneeID)

			// Wake the worker
			run.mu.RLock()
			wake, ok := run.WakeSignals[*task.AssigneeID]
			run.mu.RUnlock()
			if ok {
				select {
				case wake <- struct{}{}:
				default:
				}
			}

		case "approve_task":
			taskID, _ := tc.Args["taskId"].(string)
			comment, _ := tc.Args["comment"].(string)

			task, err := deps.DB.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != run.ProjectID {
				break
			}
			if err := deps.DB.UpdateTaskStatus(ctx, taskID, "completed"); err != nil {
				return nil, fmt.Errorf("approve task: %w", err)
			}
			who := strOrEmpty(task.AssigneeName)
			msg := fmt.Sprintf("[CEO 已通过] %s（%s）交付已确认。", task.Title, who)
			if comment != "" {
				msg = fmt.Sprintf("[CEO 已通过] %s（%s）— %s", task.Title, who, comment)
			}
			_ = sendSystemMsg(ctx, deps, run.ProjectID, &taskID, msg)
			cycleResult.ApprovedCount++

		case "request_info":
			roleName, _ := tc.Args["roleName"].(string)
			question, _ := tc.Args["question"].(string)

			emp := findEmployeeByRole(employees, roleName)
			if emp == nil {
				break
			}

			err := retryWithBackoff(ctx, func() error {
				infoResult, err := deps.Runtime.Run(ctx, agent.RunOptions{
					EmployeeID: emp.ID,
					ProjectID:  run.ProjectID,
					AdditionalMessages: []llm.ChatMessage{
						{Role: "user", Content: fmt.Sprintf("[CEO asks]: %s", question)},
					},
				})
				if err != nil {
					return err
				}
				if infoResult.Content == "" {
					return nil
				}

				const docThreshold = 150
				looksLikeDoc := len(infoResult.Content) > docThreshold ||
					containsMarkdownHeaders(infoResult.Content)

				if looksLikeDoc {
					brief := infoResult.Content
					if len(brief) > 80 {
						brief = brief[:80] + "…"
					}
					title := question
					if len(title) > 40 {
						title = title[:40] + "…"
					}
					file, err := deps.DB.CreateProjectFile(ctx,
						run.ProjectID, emp.ID, nil,
						fmt.Sprintf("%s 回复：%s", emp.Name, title),
						nil, infoResult.Content, brief, "document",
					)
					if err != nil {
						return err
					}
					senderID := emp.ID
					_ = sendAgentMsg(ctx, deps, run.ProjectID, nil, &senderID,
						fmt.Sprintf("[%s replies to CEO] %s → 查看文档", emp.Name, brief),
						map[string]interface{}{"fileId": file.ID, "brief": brief, "fileType": "document"})
				} else {
					senderID := emp.ID
					_ = sendAgentMsg(ctx, deps, run.ProjectID, nil, &senderID,
						fmt.Sprintf("[%s replies to CEO]: %s", emp.Name, infoResult.Content), nil)
				}
				return nil
			}, func(attempt int, err error) {
				_ = sendSystemMsg(ctx, deps, run.ProjectID, nil,
					fmt.Sprintf("request_info from %s failed (attempt %d/3), retrying...", roleName, attempt))
			})
			if err != nil {
				_ = sendSystemMsg(ctx, deps, run.ProjectID, nil,
					fmt.Sprintf("Request to %s failed: %v", emp.Name, err))
			}
		}
	}

	return cycleResult, nil
}

// shouldSelfTrigger decides if the CEO should immediately re-trigger itself
func shouldSelfTrigger(result *CeoCycleResult, tasks []db.TaskWithAssignment) bool {
	// Workers are being woken — they will trigger CEO when done, no need to self-trigger
	if len(result.AssignedEmployeeIDs) > 0 {
		return false
	}
	// Saved document → immediately proceed to impl phase
	if result.SavedDocument {
		return true
	}
	// Approved all tasks with no new assignments → evaluate project completion immediately
	if result.ApprovedCount > 0 {
		return true
	}
	// has_active_work with nothing to do → wait for workers
	if AllTasksActiveOrInProgress(tasks) {
		return false
	}
	return false
}

// Helper: find employee by role name
func findEmployeeByRole(employees []db.EmployeeWithRole, roleName string) *db.EmployeeWithRole {
	for i := range employees {
		if employees[i].RoleName == roleName {
			return &employees[i]
		}
	}
	return nil
}

func strOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func containsMarkdownHeaders(s string) bool {
	for i := 0; i < len(s)-2; i++ {
		if s[i] == '#' && (i == 0 || s[i-1] == '\n') {
			return true
		}
	}
	return false
}

// sendSystemMsg persists a system message and publishes to bus
func sendSystemMsg(ctx context.Context, deps *Deps, projectID string, taskID *string, content string, metadata ...map[string]interface{}) error {
	var meta map[string]interface{}
	if len(metadata) > 0 {
		meta = metadata[0]
	}
	msg, err := deps.DB.CreateMessage(ctx, projectID, taskID, nil, "system", content, meta)
	if err != nil {
		return err
	}
	deps.Bus.Publish(bus.BusMessage{
		ID:          msg.ID,
		ProjectID:   projectID,
		TaskID:      taskID,
		SenderType:  "system",
		MessageType: "status_update",
		Content:     content,
		Metadata:    meta,
		CreatedAt:   msg.CreatedAt,
	})
	return nil
}

// sendAgentMsg persists an agent message and publishes to bus
func sendAgentMsg(ctx context.Context, deps *Deps, projectID string, taskID *string, senderID *string, content string, metadata map[string]interface{}) error {
	msg, err := deps.DB.CreateMessage(ctx, projectID, taskID, senderID, "agent", content, metadata)
	if err != nil {
		return err
	}
	deps.Bus.Publish(bus.BusMessage{
		ID:          msg.ID,
		ProjectID:   projectID,
		TaskID:      taskID,
		SenderID:    senderID,
		SenderType:  "agent",
		MessageType: "deliverable",
		Content:     content,
		Metadata:    metadata,
		CreatedAt:   msg.CreatedAt,
	})
	return nil
}
