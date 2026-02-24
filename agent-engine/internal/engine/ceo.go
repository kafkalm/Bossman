package engine

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

const maxCeoIterations = 200

// ─── CEO ─────────────────────────────────────────────────────────────────────

// CEO is the rich model for a CEO agent. It owns its loop and is triggered by project IDs.
type CEO struct {
	id         string
	companyID  string
	name       string
	iterations map[string]int // projectID → iteration count
	svc        *Service
	trigger    chan string
}

// NewCEO creates a new CEO employee.
func NewCEO(emp db.EmployeeWithRole, svc *Service) *CEO {
	return &CEO{
		id:         emp.ID,
		companyID:  emp.CompanyID,
		name:       emp.Name,
		iterations: make(map[string]int),
		svc:        svc,
		trigger:    make(chan string, 100),
	}
}

// Loop is the main goroutine entry point for a CEO. Runs until ctx is cancelled.
func (c *CEO) Loop(ctx context.Context) error {
	c.ceoLoop(ctx)
	return nil
}

// TriggerProject sends a non-blocking project trigger to this CEO.
func (c *CEO) TriggerProject(projectID string) {
	select {
	case c.trigger <- projectID:
	default:
	}
}

// ceoLoop waits for project triggers or polls in-progress projects on a ticker.
func (c *CEO) ceoLoop(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case projectID := <-c.trigger:
			c.runOneCeoCycle(ctx, projectID)

		case <-ticker.C:
			projectIDs, err := c.svc.db.GetInProgressProjectIDsByCompany(ctx, c.companyID)
			if err != nil {
				continue
			}
			for _, projectID := range projectIDs {
				c.runOneCeoCycle(ctx, projectID)
				break // one project per tick to avoid starving others
			}
		}
	}
}

func (c *CEO) runOneCeoCycle(ctx context.Context, projectID string) {
	project, err := c.svc.db.GetProject(ctx, projectID)
	if err != nil {
		log.Printf("[CEO %s] load project error: %v", projectID, err)
		return
	}
	if project.Status != "in_progress" {
		return
	}

	founderMessage := c.svc.takeFounderMessage(projectID)
	runState := &projectRunState{svc: c.svc, ceo: c, projectID: projectID}

	iter := c.iterations[projectID]
	if iter > maxCeoIterations-1 {
		iter = maxCeoIterations - 1
	}

	result, err := c.runCycle(ctx, CeoCycleRequest{
		RunState:       runState,
		Iteration:      iter,
		MaxIterations:  maxCeoIterations,
		FounderMessage: founderMessage,
	})
	if err != nil {
		log.Printf("[CEO %s] cycle error (iter %d): %v", projectID, c.iterations[projectID], err)
		return
	}

	c.iterations[projectID]++

	if result.ShouldStop {
		c.svc.StopProject(projectID)
		return
	}

	// Schedule a safety self-wake so the project doesn't hang if workers fail silently
	if result.Skipped {
		time.AfterFunc(30*time.Second, func() { c.TriggerProject(projectID) })
		return
	}

	projectAfter, err := c.svc.db.GetProject(ctx, projectID)
	if err == nil && (projectAfter.Status == "completed" || projectAfter.Status == "failed") {
		return
	}

	tasks, _ := c.svc.db.GetTasksForProject(ctx, projectID)
	if shouldSelfTrigger(result, tasks) {
		c.TriggerProject(projectID)
	}
}

// ─── CEO cycle logic ──────────────────────────────────────────────────────────

// CeoCycleResult is the result of a single CEO cycle
type CeoCycleResult struct {
	ShouldStop          bool
	Skipped             bool
	AssignedEmployeeIDs []string
	ApprovedCount       int
	SavedDocument       bool
}

// CeoCycleRequest holds the per-call inputs for a single CEO management cycle.
type CeoCycleRequest struct {
	RunState       ProjectRunState
	Iteration      int
	MaxIterations  int
	FounderMessage string
}

// runCycle executes one CEO management cycle:
// load project → build snapshot → select phase → call LLM → process tool calls
func (c *CEO) runCycle(ctx context.Context, req CeoCycleRequest) (*CeoCycleResult, error) {
	projectID := req.RunState.ProjectID()

	// Load project
	project, err := c.svc.db.GetProject(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}

	// Load employees
	employees, err := c.svc.db.GetProjectEmployees(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load employees: %w", err)
	}

	ceo := findEmployeeByRole(employees, "ceo")
	if ceo == nil {
		return &CeoCycleResult{}, nil
	}

	// Load tasks
	tasks, err := c.svc.db.GetTasksForProject(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load tasks: %w", err)
	}

	// Build snapshot
	snapshot, err := buildProjectSnapshot(ctx, c.svc.db, project, tasks, employees)
	if err != nil {
		return nil, fmt.Errorf("build snapshot: %w", err)
	}

	// Determine phase and build prompt
	var promptContent string
	if req.FounderMessage != "" {
		promptContent = BuildFounderPrompt(req.FounderMessage, snapshot)
	} else {
		phase := GetCeoPhase(project, tasks)
		// Smart skip: if has_active_work and all tasks are purely waiting, skip LLM call
		if phase == PhaseHasActiveWork && AllTasksActiveOrInProgress(tasks) {
			return &CeoCycleResult{Skipped: true}, nil
		}
		promptContent = BuildPromptForPhase(phase, project, snapshot, req.Iteration, req.MaxIterations)
	}

	// Build team roles for CEO tools
	var teamRoles []string
	for _, emp := range employees {
		if emp.RoleName != "ceo" {
			teamRoles = append(teamRoles, emp.RoleName)
		}
	}

	ceoTools := buildCeoTools(teamRoles)

	// Call LLM
	result, err := c.svc.Run(ctx, RunOptions{
		Employee:           ceo,
		Project:            project,
		Tools:              ceoTools,
		AdditionalMessages: []llm.ChatMessage{{Role: "user", Content: promptContent}},
	})
	if err != nil {
		return nil, fmt.Errorf("CEO LLM call: %w", err)
	}

	if len(result.ToolCalls) == 0 {
		return &CeoCycleResult{}, nil
	}

	return c.processToolCalls(ctx, req.RunState, project, employees, result.ToolCalls)
}

// processToolCalls handles all CEO tool invocations
func (c *CEO) processToolCalls(
	ctx context.Context,
	runState ProjectRunState,
	project *db.Project,
	employees []db.EmployeeWithRole,
	toolCalls []llm.ToolCall,
) (*CeoCycleResult, error) {
	cycleResult := &CeoCycleResult{}
	projectID := runState.ProjectID()

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
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
				fmt.Sprintf("⚠️ Could not assign task \"%s\" — no employee with role \"%s\" found.", taskTitle, roleName))
			continue
		}

		task, err := c.svc.db.CreateTask(ctx, projectID, taskTitle, taskDescription, priority)
		if err != nil {
			return nil, fmt.Errorf("create task: %w", err)
		}

		if err := c.svc.db.AssignTask(ctx, task.ID, emp.ID); err != nil {
			return nil, fmt.Errorf("assign task: %w", err)
		}

		_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &task.ID,
			fmt.Sprintf("Task \"%s\" has been assigned to %s (%s).", taskTitle, emp.Name, emp.RoleTitle),
			map[string]interface{}{"taskId": task.ID, "employeeId": emp.ID})

		cycleResult.AssignedEmployeeIDs = append(cycleResult.AssignedEmployeeIDs, emp.ID)

		runState.WakeWorker(emp.ID)
	}

	// Process remaining tools
	for _, tc := range toolCalls {
		switch tc.Name {
		case "assign_task":
			// Already handled above

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
			if err := c.svc.db.UpdateProjectStatus(ctx, projectID, status); err != nil {
				return nil, fmt.Errorf("update status: %w", err)
			}
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil,
				fmt.Sprintf("Project status updated to **%s**: %s", status, summary))
			if status == "completed" || status == "failed" {
				cycleResult.ShouldStop = true
			}

		case "send_message":
			content, _ := tc.Args["content"].(string)
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, nil, "[CEO] "+content)

		case "request_revision":
			taskID, _ := tc.Args["taskId"].(string)
			feedback, _ := tc.Args["feedback"].(string)

			task, err := c.svc.db.GetTask(ctx, taskID)
			if err != nil || task.Task.ProjectID != projectID {
				break
			}
			if task.AssigneeID == nil {
				break
			}

			if err := c.svc.db.ClearTaskOutput(ctx, taskID); err != nil {
				return nil, fmt.Errorf("clear task output: %w", err)
			}

			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &taskID,
				fmt.Sprintf("[CEO 要求修改] %s 的《%s》质量不达标，需根据反馈重新编写。",
					strOrEmpty(task.AssigneeName), task.Title))
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
			if err := c.svc.db.UpdateTaskStatus(ctx, taskID, "completed"); err != nil {
				return nil, fmt.Errorf("approve task: %w", err)
			}
			who := strOrEmpty(task.AssigneeName)
			msg := fmt.Sprintf("[CEO 已通过] %s（%s）交付已确认。", task.Title, who)
			if comment != "" {
				msg = fmt.Sprintf("[CEO 已通过] %s（%s）— %s", task.Title, who, comment)
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
						fmt.Sprintf("[%s replies to CEO] %s → 查看文档", emp.Name, brief),
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

// findEmployeeByRole finds an employee by role name
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
func sendSystemMsg(ctx context.Context, database *db.DB, msgBus *bus.Bus, projectID string, taskID *string, content string, metadata ...map[string]interface{}) error {
	var meta map[string]interface{}
	if len(metadata) > 0 {
		meta = metadata[0]
	}
	msg, err := database.CreateMessage(ctx, projectID, taskID, nil, "system", content, meta)
	if err != nil {
		return err
	}
	msgBus.Publish(bus.BusMessage{
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
func sendAgentMsg(ctx context.Context, database *db.DB, msgBus *bus.Bus, projectID string, taskID *string, senderID *string, content string, metadata map[string]interface{}) error {
	msg, err := database.CreateMessage(ctx, projectID, taskID, senderID, "agent", content, metadata)
	if err != nil {
		return err
	}
	msgBus.Publish(bus.BusMessage{
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

// buildCeoTools returns tool definitions for the CEO agent.
func buildCeoTools(teamRoles []string) []llm.ToolDefinition {
	if len(teamRoles) == 0 {
		return nil
	}

	minPriority := 0.0
	maxPriority := 10.0
	defaultPriority := 5.0

	return []llm.ToolDefinition{
		{
			Name:        "assign_task",
			Description: "Create and assign one task to a team member. Only assign to roles you have already decided to involve (minimal set needed for the project). Call this tool multiple times to assign several subtasks to the involved employees for concurrent execution. Task types: documentation, implementation, review, research, design, testing, etc.",
			Parameters: map[string]*llm.ToolParameter{
				"roleName": {
					Type:        "string",
					Description: "The role of the team member to assign the task to",
					Enum:        teamRoles,
				},
				"taskTitle": {
					Type:        "string",
					Description: "A concise title for the task",
				},
				"taskDescription": {
					Type:        "string",
					Description: "Detailed description of the task, including context, requirements, and expected deliverables",
				},
				"priority": {
					Type:        "number",
					Description: "Priority level (0-10, higher = more important)",
					Minimum:     &minPriority,
					Maximum:     &maxPriority,
					Default:     defaultPriority,
				},
			},
			Required: []string{"roleName", "taskTitle", "taskDescription"},
		},
		{
			Name:        "save_project_document",
			Description: "Save or update the project document. Call this with the complete, well-structured project document in markdown format. Use this after reviewing team contributions to compile a unified document.",
			Parameters: map[string]*llm.ToolParameter{
				"document": {
					Type:        "string",
					Description: "The complete project document in markdown format, synthesizing all team contributions.",
				},
			},
			Required: []string{"document"},
		},
		{
			Name:        "update_project_status",
			Description: `Update the overall project status. Use "review" when the project is ready for Founder acceptance (do NOT use "completed" — only the Founder can mark the project completed after acceptance). Use "planning", "in_progress", "failed" as needed.`,
			Parameters: map[string]*llm.ToolParameter{
				"status": {
					Type:        "string",
					Description: "The new project status",
					Enum:        []string{"planning", "in_progress", "review", "completed", "failed"},
				},
				"summary": {
					Type:        "string",
					Description: "A brief summary of what has been accomplished",
				},
			},
			Required: []string{"status", "summary"},
		},
		{
			Name:        "send_message",
			Description: "Send an announcement to the project channel, visible to the Founder and all team members.",
			Parameters: map[string]*llm.ToolParameter{
				"content": {
					Type:        "string",
					Description: "The message content",
				},
			},
			Required: []string{"content"},
		},
		{
			Name:        "request_revision",
			Description: "Send a task deliverable back to the assigned employee for revision. Use this when the output quality is insufficient, information is incomplete, or the deliverable does not meet requirements. The employee will receive your feedback and re-submit.",
			Parameters: map[string]*llm.ToolParameter{
				"taskId": {
					Type:        "string",
					Description: "The task ID (shown in the task list as taskId: `xxx`) whose deliverable needs revision",
				},
				"feedback": {
					Type:        "string",
					Description: "Specific feedback for the employee: what is wrong, what to improve, what is missing. Be concrete so they can fix it.",
				},
			},
			Required: []string{"taskId", "feedback"},
		},
		{
			Name:        "approve_task",
			Description: "Mark a task as completed. Only the CEO can decide when a task is done. Use this when the deliverable has been reviewed and meets your requirements. Do NOT approve if the employee has asked for clarification and you have not yet answered, or if quality is not satisfactory (use request_revision instead).",
			Parameters: map[string]*llm.ToolParameter{
				"taskId": {
					Type:        "string",
					Description: "The task ID (shown in the task list as taskId: `xxx`) to mark as completed",
				},
				"comment": {
					Type:        "string",
					Description: "Optional brief note for the record (e.g. what was approved)",
				},
			},
			Required: []string{"taskId"},
		},
		{
			Name:        "request_info",
			Description: "Ask a specific team member a question and get their response immediately, without creating a formal task.",
			Parameters: map[string]*llm.ToolParameter{
				"roleName": {
					Type:        "string",
					Description: "The role of the team member to ask",
					Enum:        teamRoles,
				},
				"question": {
					Type:        "string",
					Description: "The question to ask",
				},
			},
			Required: []string{"roleName", "question"},
		},
	}
}
