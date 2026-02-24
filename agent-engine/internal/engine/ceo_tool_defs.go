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
			Description: "Create and assign one task to a team member. Only assign to roles you have already decided to involve (minimal set needed for the project). Call this tool multiple times to assign several subtasks to the involved employees for concurrent execution. Task types: documentation, implementation, review, research, design, testing, etc.",
			Parameters: map[string]*llm.ToolParameter{
				"roleName":        {Type: "string", Description: "The role of the team member to assign the task to", Enum: teamRoles},
				"taskTitle":       {Type: "string", Description: "A concise title for the task"},
				"taskDescription": {Type: "string", Description: "Detailed description of the task, including context, requirements, and expected deliverables"},
				"priority":        {Type: "number", Description: "Priority level (0-10, higher = more important)", Minimum: &minPriority, Maximum: &maxPriority, Default: defaultPriority},
			},
			Required: []string{"roleName", "taskTitle", "taskDescription"},
		},
		{
			Name:        "save_project_document",
			Description: "Save or update the project document. Call this with the complete, well-structured project document in markdown format. Use this after reviewing team contributions to compile a unified document.",
			Parameters:  map[string]*llm.ToolParameter{"document": {Type: "string", Description: "The complete project document in markdown format, synthesizing all team contributions."}},
			Required:    []string{"document"},
		},
		{
			Name:        "update_project_status",
			Description: `Update the overall project status. Use "review" when the project is ready for Founder acceptance (do NOT use "completed" - only the Founder can mark the project completed after acceptance). Use "planning", "in_progress", "failed" as needed.`,
			Parameters: map[string]*llm.ToolParameter{
				"status":  {Type: "string", Description: "The new project status", Enum: []string{ProjectStatusPlanning, ProjectStatusInProgress, ProjectStatusReview, ProjectStatusCompleted, ProjectStatusFailed}},
				"summary": {Type: "string", Description: "A brief summary of what has been accomplished"},
			},
			Required: []string{"status", "summary"},
		},
		{
			Name:        "send_message",
			Description: "Send an announcement to the project channel, visible to the Founder and all team members.",
			Parameters:  map[string]*llm.ToolParameter{"content": {Type: "string", Description: "The message content"}},
			Required:    []string{"content"},
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
			Description: "Mark a task as completed. Only the CEO can decide when a task is done. Use this when the deliverable has been reviewed and meets your requirements. Do NOT approve if the employee has asked for clarification and you have not yet answered, or if quality is not satisfactory (use request_revision instead).",
			Parameters: map[string]*llm.ToolParameter{
				"taskId":  {Type: "string", Description: "The task ID (shown in the task list as taskId: `xxx`) to mark as completed"},
				"comment": {Type: "string", Description: "Optional brief note for the record (e.g. what was approved)"},
			},
			Required: []string{"taskId"},
		},
		{
			Name:        "request_info",
			Description: "Ask a specific team member a question and get their response immediately, without creating a formal task.",
			Parameters: map[string]*llm.ToolParameter{
				"roleName": {Type: "string", Description: "The role of the team member to ask", Enum: teamRoles},
				"question": {Type: "string", Description: "The question to ask"},
			},
			Required: []string{"roleName", "question"},
		},
	}
}
