package engine

import "github.com/kafkalm/bossman/agent-engine/internal/llm"

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
			Description: "Create and assign one task to a team member, or reschedule an existing task by providing taskId. Only assign to roles you have already decided to involve (minimal set needed for the project). Call this tool multiple times to assign several subtasks to the involved employees for concurrent execution. Task types: documentation, implementation, review, research, design, testing, etc.",
			Parameters: map[string]*llm.ToolParameter{
				"roleName":        {Type: "string", Description: "The role of the team member to assign the task to", Enum: teamRoles},
				"taskId":          {Type: "string", Description: "Optional existing task ID to reschedule/reassign instead of creating a new task"},
				"taskTitle":       {Type: "string", Description: "A concise title for the task"},
				"taskDescription": {Type: "string", Description: "Detailed description of the task, including context, requirements, and expected deliverables"},
				"priority":        {Type: "number", Description: "Priority level (0-10, higher = more important)", Minimum: &minPriority, Maximum: &maxPriority, Default: defaultPriority},
			},
			Required: []string{"roleName", "taskTitle", "taskDescription"},
		},
		{
			Name:        "update_task",
			Description: "Update an existing task's title/description/priority for rework, clear old output, then set it back to todo for execution.",
			Parameters: map[string]*llm.ToolParameter{
				"taskId":          {Type: "string", Description: "Task ID to update"},
				"taskTitle":       {Type: "string", Description: "Optional new task title"},
				"taskDescription": {Type: "string", Description: "Optional new task description/requirements"},
				"priority":        {Type: "number", Description: "Optional new priority (0-10)", Minimum: &minPriority, Maximum: &maxPriority},
				"reason":          {Type: "string", Description: "Why this update is needed"},
			},
			Required: []string{"taskId", "reason"},
		},
		{
			Name:        "reassign_task",
			Description: "Reassign an existing task to another role, then set task status to todo and wake the new assignee.",
			Parameters: map[string]*llm.ToolParameter{
				"taskId":   {Type: "string", Description: "Task ID to reassign"},
				"roleName": {Type: "string", Description: "Role to assign this task to", Enum: teamRoles},
				"reason":   {Type: "string", Description: "Why reassignment is required"},
			},
			Required: []string{"taskId", "roleName", "reason"},
		},
		{
			Name:        "unblock_task",
			Description: "Move blocked task back to todo and wake assignee for execution.",
			Parameters: map[string]*llm.ToolParameter{
				"taskId": {Type: "string", Description: "Blocked task ID"},
				"reason": {Type: "string", Description: "Why task can be unblocked now"},
			},
			Required: []string{"taskId", "reason"},
		},
		{
			Name:        "save_project_document",
			Description: "Save or update the project document. Call this with the complete, well-structured project document in markdown format. Use this after reviewing team contributions to compile a unified document.",
			Parameters:  map[string]*llm.ToolParameter{"document": {Type: "string", Description: "The complete project document in markdown format, synthesizing all team contributions."}},
			Required:    []string{"document"},
		},
		{
			Name:        "update_project_status",
			Description: `Update project status. Use "review" for Founder acceptance; use "active" to resume work; use "blocked" only if progress cannot continue.`,
			Parameters: map[string]*llm.ToolParameter{
				"status":  {Type: "string", Description: "The new project status", Enum: []string{ProjectStatusActive, ProjectStatusReview, ProjectStatusBlocked}},
				"summary": {Type: "string", Description: "A brief summary of what has been accomplished"},
			},
			Required: []string{"status", "summary"},
		},
		{
			Name:        "request_revision",
			Description: "Send a task deliverable back to the assigned employee for revision. Use this when the output quality is insufficient, information is incomplete, or the deliverable does not meet requirements. The employee will receive your feedback and re-submit.",
			Parameters: map[string]*llm.ToolParameter{
				"taskId":   {Type: "string", Description: "The task ID (shown in the task list as taskId: `xxx`) whose deliverable needs revision"},
				"feedback": {Type: "string", Description: "Specific feedback for the employee: what is wrong, what to improve, what is missing. Be concrete so they can fix it."},
			},
			Required: []string{"taskId", "feedback"},
		},
		{
			Name:        "approve_task",
			Description: "Mark a task as done. Only the CEO can decide when a task is done. Use this when the deliverable has been reviewed and meets your requirements. Do NOT approve if quality is not satisfactory (use request_revision instead).",
			Parameters: map[string]*llm.ToolParameter{
				"taskId":  {Type: "string", Description: "The task ID (shown in the task list as taskId: `xxx`) to mark as completed"},
				"comment": {Type: "string", Description: "Optional brief note for the record (e.g. what was approved)"},
			},
			Required: []string{"taskId"},
		},
		{
			Name:        "block_task",
			Description: "Mark a task blocked with concrete reason when it cannot proceed.",
			Parameters: map[string]*llm.ToolParameter{
				"taskId":   {Type: "string", Description: "Task ID to mark blocked"},
				"reason":   {Type: "string", Description: "Why task is blocked"},
				"nextStep": {Type: "string", Description: "Suggested recovery path"},
			},
			Required: []string{"taskId", "reason"},
		},
	}
}
