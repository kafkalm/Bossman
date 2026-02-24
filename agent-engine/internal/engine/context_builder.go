package engine

import (
	"context"
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

const maxContextMessages = 50
const projectContextMessages = 20

// BuildAgentContext assembles the message history for an agent LLM call.
func (s *Service) BuildAgentContext(ctx context.Context, emp *db.EmployeeWithRole, project *db.Project, task *db.Task) ([]llm.ChatMessage, error) {
	var messages []llm.ChatMessage

	messages = append(messages, llm.ChatMessage{
		Role:    "user",
		Content: formatProjectContext(emp, project, task),
	})

	if task != nil {
		projectMsgs, err := s.db.GetProjectMessages(ctx, project.ID, projectContextMessages)
		if err != nil {
			return nil, fmt.Errorf("project messages: %w", err)
		}
		taskMsgs, err := s.db.GetTaskMessages(ctx, task.ID)
		if err != nil {
			return nil, fmt.Errorf("task messages: %w", err)
		}

		merged := mergeAndDedup(projectMsgs, taskMsgs)
		for _, msg := range merged {
			messages = append(messages, convertDBMessage(msg, emp.ID))
		}
	} else {
		projectMsgs, err := s.db.GetProjectMessages(ctx, project.ID, maxContextMessages)
		if err != nil {
			return nil, fmt.Errorf("project messages: %w", err)
		}
		for _, msg := range projectMsgs {
			messages = append(messages, convertDBMessage(msg, emp.ID))
		}
	}

	return trimContext(messages), nil
}

func formatProjectContext(emp *db.EmployeeWithRole, project *db.Project, task *db.Task) string {
	s := fmt.Sprintf("You are %s, serving as %s in this project.\n\n", emp.Name, emp.RoleTitle)
	s += fmt.Sprintf("## Project: %s\n%s\n\n", project.Name, project.Description)

	if task != nil {
		s += fmt.Sprintf("## Your Current Task: %s\n%s\n\n", task.Title, task.Description)
	}

	s += "## Your Workspace\n"
	s += "You have a personal workspace (your folder in the project's Document/Code tab). Save your work there as you go:\n"
	s += "- Use **save_to_workspace** to save drafts, outlines, research notes, and intermediate code.\n"
	s += "- Use **create_file** for final deliverables to submit to the CEO.\n"
	s += "- Use **execute_command** to run shell commands (build, test, install packages, etc.) in the project workspace.\n\n"
	s += "Please complete your assigned work. Be thorough and professional."

	return s
}

func convertDBMessage(msg db.Message, selfEmployeeID string) llm.ChatMessage {
	if msg.SenderType == "agent" && msg.SenderID != nil && *msg.SenderID == selfEmployeeID {
		return llm.ChatMessage{Role: "assistant", Content: msg.Content}
	}
	label := senderLabel(msg)
	return llm.ChatMessage{
		Role:    "user",
		Content: fmt.Sprintf("[%s]: %s", label, msg.Content),
	}
}

func senderLabel(msg db.Message) string {
	switch msg.SenderType {
	case "founder":
		return "Founder"
	case "system":
		return "System"
	default:
		return "Agent"
	}
}

func mergeAndDedup(a, b []db.Message) []db.Message {
	seen := make(map[string]bool, len(a)+len(b))
	var result []db.Message
	for _, m := range a {
		if !seen[m.ID] {
			seen[m.ID] = true
			result = append(result, m)
		}
	}
	for _, m := range b {
		if !seen[m.ID] {
			seen[m.ID] = true
			result = append(result, m)
		}
	}
	for i := 1; i < len(result); i++ {
		for j := i; j > 0 && result[j].CreatedAt.Before(result[j-1].CreatedAt); j-- {
			result[j], result[j-1] = result[j-1], result[j]
		}
	}
	return result
}

func trimContext(messages []llm.ChatMessage) []llm.ChatMessage {
	if len(messages) <= maxContextMessages {
		return messages
	}
	first := messages[0]
	recent := messages[len(messages)-(maxContextMessages-1):]
	return append([]llm.ChatMessage{first}, recent...)
}
