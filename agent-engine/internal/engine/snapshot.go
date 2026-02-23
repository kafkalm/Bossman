package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

// buildProjectSnapshot builds the CEO prompt snapshot string
func buildProjectSnapshot(ctx context.Context, deps *Deps, project *db.Project, tasks []db.TaskWithAssignment, employees []db.EmployeeWithRole) (string, error) {
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
			"pending":     "⏳",
			"assigned":    "📋",
			"in_progress": "🔄",
			"completed":   "✅",
			"blocked":     "❌",
			"review":      "🔍",
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
		completed := countByStatus(tasks, "completed")
		inReview := countByStatus(tasks, "review")
		inProgress := countByStatus(tasks, "in_progress")
		blocked := countByStatus(tasks, "blocked")
		lines = append(lines, "")
		lines = append(lines, fmt.Sprintf("**Progress**: %d/%d completed, %d in review, %d in-progress, %d blocked",
			completed, total, inReview, inProgress, blocked))
	}

	// Recent messages
	recentMsgs, err := deps.DB.GetRecentProjectMessages(ctx, project.ID, 15)
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
					// Try to get sender name
					name, title, err := deps.DB.GetSenderName(ctx, *msg.SenderID)
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

func countByStatus(tasks []db.TaskWithAssignment, status string) int {
	n := 0
	for _, t := range tasks {
		if t.Status == status {
			n++
		}
	}
	return n
}
