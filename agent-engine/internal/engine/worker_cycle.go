package engine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

// executeForEmployee runs the LLM for a worker task, processes tool calls, and sets task status.
func (w *Worker) executeForEmployee(ctx context.Context, taskID string) error {
	task, err := w.svc.db.GetTask(ctx, taskID)
	if err != nil {
		return fmt.Errorf("load task: %w", err)
	}
	if task.AssigneeID == nil {
		return fmt.Errorf("task %s has no assigned employee", taskID)
	}

	projectID := task.Task.ProjectID
	employeeID := *task.AssigneeID
	validateTaskTransitionOrWarn(task.Status, TaskStatusInProgress, taskID)
	if err := w.svc.db.UpdateTaskStatus(ctx, taskID, TaskStatusInProgress); err != nil {
		return fmt.Errorf("update task in_progress: %w", err)
	}

	taskIDPtr := taskID
	employees, err := w.svc.db.GetProjectEmployees(ctx, projectID)
	if err != nil {
		return fmt.Errorf("load employees: %w", err)
	}

	result, err := w.svc.Run(ctx, RunOptions{
		EmployeeID: employeeID,
		ProjectID:  projectID,
		Task:       &task.Task,
		Tools:      workerTools(),
	})
	if err != nil {
		return fmt.Errorf("worker LLM call: %w", err)
	}

	var reports []string
	hadDeliverableTool := false
	projectWorkspaceRoot, _ := w.svc.workspace.ProjectRoot(projectID)

	for _, tc := range result.ToolCalls {
		switch tc.Name {
		case "report_to_ceo":
			hadDeliverableTool = true
			report, _ := tc.Args["report"].(string)
			reports = append(reports, report)
			if err := w.createFileAndNotify(ctx, projectID, employeeID, &taskIDPtr, task.Task.Title, report, "document"); err != nil {
				return fmt.Errorf("report_to_ceo file: %w", err)
			}
		case "create_file", "save_to_workspace":
			hadDeliverableTool = true
			title, _ := tc.Args["title"].(string)
			if title == "" {
				title = "untitled"
			}
			content, _ := tc.Args["content"].(string)
			fileType := "code"
			if tc.Name == "save_to_workspace" {
				fileType = "document"
			}
			if ft, ok := tc.Args["fileType"].(string); ok && ft != "" {
				fileType = ft
			}
			if err := w.createFileAndNotify(ctx, projectID, employeeID, &taskIDPtr, title, content, fileType); err != nil {
				return fmt.Errorf("%s file: %w", tc.Name, err)
			}
			label := "文档"
			if fileType == "code" {
				label = "代码"
			}
			reports = append(reports, fmt.Sprintf("[%s] 已保存%s -> %s", strOrEmpty(&task.Task.Title), label, title))
		case "list_workspace_files":
			entries, err := w.svc.workspace.ListFiles(projectID)
			if err != nil || len(entries) == 0 {
				reports = append(reports, "[Workspace files]\nNo files in workspace.")
			} else {
				var sb strings.Builder
				sb.WriteString("[Workspace files]\n")
				for _, e := range entries {
					sb.WriteString(e.RelativePath + "\n")
				}
				reports = append(reports, sb.String())
			}
		case "read_file":
			relativePath, _ := tc.Args["relativePath"].(string)
			content, err := w.svc.workspace.ReadFile(projectID, relativePath)
			if err != nil {
				reports = append(reports, fmt.Sprintf("[Read file: %s] (not found or unreadable)", relativePath))
			} else {
				reports = append(reports, fmt.Sprintf("[Read file: %s]\n%s", relativePath, content))
			}
		case "ask_colleague":
			colleagueRole, _ := tc.Args["colleague_role"].(string)
			question, _ := tc.Args["question"].(string)
			colleague := findEmployeeByRole(employees, colleagueRole)
			if colleague == nil {
				reports = append(reports, fmt.Sprintf("[ask_colleague] No employee with role '%s' found", colleagueRole))
				break
			}
			colResult, err := w.svc.Run(ctx, RunOptions{
				Employee:  colleague,
				ProjectID: projectID,
				AdditionalMessages: []llm.ChatMessage{
					{Role: "user", Content: fmt.Sprintf("[%s asks you]: %s", strOrEmpty(task.AssigneeName), question)},
				},
			})
			if err != nil || colResult.Content == "" {
				reports = append(reports, fmt.Sprintf("[ask_colleague] %s did not respond", colleague.Name))
				senderID := employeeID
				_ = sendAgentMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskIDPtr, &senderID,
					fmt.Sprintf("[%s asks %s]: %s", strOrEmpty(task.AssigneeName), colleagueRole, question), nil)
			} else {
				reports = append(reports, fmt.Sprintf("[%s replied]: %s", colleague.Name, colResult.Content))
				colID := colleague.ID
				_ = sendAgentMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskIDPtr, &colID,
					fmt.Sprintf("[%s replied to %s]: %s", colleague.Name, strOrEmpty(task.AssigneeName), colResult.Content), nil)
			}
		case "execute_command":
			command, _ := tc.Args["command"].(string)
			workdir, _ := tc.Args["workdir"].(string)
			timeoutSecs := 120.0
			if ts, ok := tc.Args["timeout_seconds"].(float64); ok && ts > 0 && ts <= 300 {
				timeoutSecs = ts
			}
			output, exitCode, err := executeCommand(ctx, command, workdir, projectWorkspaceRoot, time.Duration(timeoutSecs)*time.Second)
			if err != nil {
				reports = append(reports, fmt.Sprintf("[execute_command] Error: %v\nOutput:\n%s", err, output))
			} else {
				reports = append(reports, fmt.Sprintf("[execute_command] Exit code: %d\nOutput:\n%s", exitCode, output))
			}
			_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskIDPtr,
				fmt.Sprintf("[%s] ran command: %s (exit %d)", strOrEmpty(task.AssigneeName), summarizeCommand(command), exitCode))
		}
	}

	if !hadDeliverableTool && result.Content != "" {
		hadDeliverableTool = true
		reports = append(reports, result.Content)
		if err := w.createFileAndNotify(ctx, projectID, employeeID, &taskIDPtr, task.Task.Title, result.Content, "document"); err != nil {
			return fmt.Errorf("fallback file: %w", err)
		}
	}

	taskOutput := strings.Join(reports, "\n\n---\n\n")
	if taskOutput != "" && hadDeliverableTool {
		validateTaskTransitionOrWarn(TaskStatusInProgress, TaskStatusReview, taskID)
		if err := w.svc.db.UpdateTaskOutput(ctx, taskID, TaskStatusReview, taskOutput); err != nil {
			return fmt.Errorf("update task review: %w", err)
		}
	} else {
		validateTaskTransitionOrWarn(TaskStatusInProgress, TaskStatusAssigned, taskID)
		if err := w.svc.db.UpdateTaskStatus(ctx, taskID, TaskStatusAssigned); err != nil {
			return fmt.Errorf("reset task assigned: %w", err)
		}
	}
	return nil
}

// createFileAndNotify creates a ProjectFile record and sends bus event.
func (w *Worker) createFileAndNotify(ctx context.Context, projectID, employeeID string, taskID *string, title, content, fileType string) error {
	brief := content
	if len(brief) > 80 {
		brief = brief[:80] + "…"
	}
	taskIDForPath := ""
	if taskID != nil {
		taskIDForPath = *taskID
	}

	var storedContent string
	if taskIDForPath != "" {
		pathDir := taskIDForPath
		_, wsErr := w.svc.workspace.WriteFile(projectID, employeeID, &pathDir, title, content)
		if wsErr != nil {
			storedContent = content
		}
	} else {
		storedContent = content
	}

	file, err := w.svc.db.CreateProjectFile(ctx, projectID, employeeID, taskID, title, nil, storedContent, brief, fileType)
	if err != nil {
		return err
	}
	tabLabel := "查看文档"
	if fileType == "code" {
		tabLabel = "查看代码"
	}
	senderID := employeeID
	w.svc.bus.Publish(busMessageDeliverable(file, projectID, taskID, &senderID, title, brief, fileType, tabLabel))
	return nil
}
