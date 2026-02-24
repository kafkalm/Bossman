package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

// CeoCycleResult is the result of a single CEO cycle.
type CeoCycleResult struct {
	ShouldStop          bool
	Skipped             bool
	AssignedEmployeeIDs []string
	ApprovedCount       int
	SavedDocument       bool
}

// CeoCycleRequest holds the per-call inputs for a single CEO management cycle.
type CeoCycleRequest struct {
	Project        *db.Project
	RunState       ProjectRunState
	Iteration      int
	MaxIterations  int
	FounderMessage string
}

// runCycle executes one CEO management cycle.
func (c *CEO) runCycle(ctx context.Context, req CeoCycleRequest) (*CeoCycleResult, error) {
	projectID := req.RunState.ProjectID()
	project := req.Project
	if project == nil {
		loadedProject, err := c.svc.db.GetProject(ctx, projectID)
		if err != nil {
			return nil, fmt.Errorf("load project: %w", err)
		}
		project = loadedProject
	}

	employees, err := c.svc.db.GetProjectEmployees(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load employees: %w", err)
	}

	ceo := findEmployeeByRole(employees, "ceo")
	if ceo == nil {
		return &CeoCycleResult{}, nil
	}

	tasks, err := c.svc.db.GetTasksForProject(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load tasks: %w", err)
	}

	snapshot, err := c.buildCycleSnapshot(ctx, project, tasks, employees)
	if err != nil {
		return nil, fmt.Errorf("build snapshot: %w", err)
	}

	var promptContent string
	if req.FounderMessage != "" {
		promptContent = BuildFounderPrompt(req.FounderMessage, snapshot)
	} else {
		phase := GetCeoPhase(project, tasks)
		if phase == PhaseHasActiveWork && AllTasksActiveOrInProgress(tasks) {
			return &CeoCycleResult{Skipped: true}, nil
		}
		promptContent = BuildPromptForPhase(phase, project, snapshot, req.Iteration, req.MaxIterations)
	}

	var teamRoles []string
	for _, emp := range employees {
		if emp.RoleName != "ceo" {
			teamRoles = append(teamRoles, emp.RoleName)
		}
	}

	result, err := c.svc.Run(ctx, RunOptions{
		Employee:           ceo,
		Project:            project,
		Tools:              buildCeoTools(teamRoles),
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

// shouldSelfTrigger decides if the CEO should immediately re-trigger itself.
func shouldSelfTrigger(result *CeoCycleResult, tasks []db.TaskWithAssignment) bool {
	if len(result.AssignedEmployeeIDs) > 0 {
		return false
	}
	if result.SavedDocument {
		return true
	}
	if result.ApprovedCount > 0 {
		return true
	}
	if AllTasksActiveOrInProgress(tasks) {
		return false
	}
	return false
}

func (c *CEO) buildCycleSnapshot(ctx context.Context, project *db.Project, tasks []db.TaskWithAssignment, employees []db.EmployeeWithRole) (string, error) {
	var lines []string

	lines = append(lines, "## Team Members")
	for _, emp := range employees {
		if emp.RoleName == "ceo" {
			continue
		}
		lines = append(lines, fmt.Sprintf("- **%s** — %s (role: `%s`)", emp.Name, emp.RoleTitle, emp.RoleName))
	}

	lines = append(lines, "")
	docStatus := "❌ Not yet compiled"
	if project.Document != nil && strings.TrimSpace(*project.Document) != "" {
		docStatus = "✅ Saved"
	}
	lines = append(lines, fmt.Sprintf("## Project Document: %s", docStatus))

	lines = append(lines, "")
	lines = append(lines, "## Tasks")
	if len(tasks) == 0 {
		lines = append(lines, "_No tasks have been created yet._")
	} else {
		statusEmoji := map[string]string{
			TaskStatusPending:    "⏳",
			TaskStatusAssigned:   "📋",
			TaskStatusInProgress: "🔄",
			TaskStatusCompleted:  "✅",
			TaskStatusBlocked:    "❌",
			TaskStatusReview:     "🔍",
		}
		for _, task := range tasks {
			emoji := statusEmoji[task.Status]
			if emoji == "" {
				emoji = "❓"
			}
			who := "Unassigned"
			if task.AssigneeName != nil {
				who = *task.AssigneeName
				if task.AssigneeTitle != nil {
					who = fmt.Sprintf("%s (%s)", *task.AssigneeName, *task.AssigneeTitle)
				}
			}
			lines = append(lines, fmt.Sprintf("%s **[%s]** %s — assigned to %s (taskId: `%s`)",
				emoji, strings.ToUpper(task.Status), task.Title, who, task.ID))
			if task.Output != nil && *task.Output != "" {
				output := *task.Output
				if len(output) > 500 {
					output = output[:500] + "\n... (truncated)"
				}
				lines = append(lines, fmt.Sprintf("  > Output:\n%s", output))
			}
		}

		total := len(tasks)
		completed := countTasksByStatus(tasks, TaskStatusCompleted)
		inReview := countTasksByStatus(tasks, TaskStatusReview)
		inProgress := countTasksByStatus(tasks, TaskStatusInProgress)
		blocked := countTasksByStatus(tasks, TaskStatusBlocked)
		lines = append(lines, "")
		lines = append(lines, fmt.Sprintf("**Progress**: %d/%d completed, %d in review, %d in-progress, %d blocked",
			completed, total, inReview, inProgress, blocked))
	}

	recentMsgs, err := c.svc.db.GetRecentProjectMessages(ctx, project.ID, 15)
	if err != nil {
		return "", fmt.Errorf("recent messages: %w", err)
	}
	if len(recentMsgs) > 0 {
		lines = append(lines, "")
		lines = append(lines, "## Recent Messages (questions, replies, updates)")
		for _, msg := range recentMsgs {
			label := "System"
			switch msg.SenderType {
			case "founder":
				label = "Founder"
			case "agent":
				if msg.SenderID != nil {
					name, title, err := c.svc.db.GetSenderName(ctx, *msg.SenderID)
					if err == nil {
						label = fmt.Sprintf("%s (%s)", name, title)
					}
				}
			}
			preview := msg.Content
			if len(preview) > 200 {
				preview = preview[:200] + "…"
			}
			lines = append(lines, fmt.Sprintf("- [%s]: %s", label, preview))
		}
	}

	return strings.Join(lines, "\n"), nil
}

func countTasksByStatus(tasks []db.TaskWithAssignment, status string) int {
	n := 0
	for _, t := range tasks {
		if t.Status == status {
			n++
		}
	}
	return n
}
