package engine

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/agent"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/engine/tools"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

const maxCommandOutputBytes = 8 * 1024 // 8KB

// ─── Worker ───────────────────────────────────────────────────────────────────

const maxEmptyRounds = 3 // consecutive no-deliverable rounds before blocking a task

// Worker is the rich model for a worker agent. It owns its loop and wakes on task assignments.
type Worker struct {
	id          string
	name        string
	svc         *Service
	wake        chan struct{}
	emptyRounds map[string]int // taskID → consecutive no-deliverable count
}

// NewWorker creates a new Worker employee.
func NewWorker(emp db.EmployeeWithRole, svc *Service) *Worker {
	return &Worker{
		id:          emp.ID,
		name:        emp.Name,
		svc:         svc,
		wake:        make(chan struct{}, 1),
		emptyRounds: make(map[string]int),
	}
}

// Loop is the main goroutine entry point for a Worker. Runs until ctx is cancelled.
func (w *Worker) Loop(ctx context.Context) error {
	w.workerLoop(ctx)
	return nil
}

// Wake sends a non-blocking wake signal to this worker.
func (w *Worker) Wake() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// workerLoop waits for wake signals or polls for assigned tasks on a ticker.
func (w *Worker) workerLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-w.wake:
			w.executeAllTasks(ctx)

		case <-ticker.C:
			w.executeAllTasks(ctx)
		}
	}
}

func (w *Worker) executeAllTasks(ctx context.Context) {
	for {
		task, projectID, err := w.svc.db.GetNextTodoTask(ctx, w.id)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				log.Printf("[Worker %s] GetNextTodoTask error: %v", w.name, err)
			}
			return
		}
		if task == nil {
			return
		}

		w.executeTask(ctx, task, projectID)
	}
}

func (w *Worker) executeTask(ctx context.Context, task *db.Task, projectID string) {
	taskID := task.ID
	taskTitle := task.Title

	err := retryWithBackoff(ctx, func() error {
		return w.executeForEmployee(ctx, taskID)
	}, func(attempt int, retryErr error) {
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
			fmt.Sprintf("Task \"%s\" failed (attempt %d/3), retrying...", taskTitle, attempt))
	})

	if err != nil {
		_ = w.svc.db.UpdateTaskStatus(ctx, taskID, "blocked")
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
			fmt.Sprintf("Task \"%s\" execution failed after 3 attempts: %v", taskTitle, err))
		w.svc.TriggerCEOForProject(projectID)
		return
	}

	// Check if the task was reset to "assigned" (no deliverable produced)
	updated, err := w.svc.db.GetTask(ctx, taskID)
	if err == nil && updated.Status == "assigned" {
		w.emptyRounds[taskID]++
		if w.emptyRounds[taskID] >= maxEmptyRounds {
			_ = w.svc.db.UpdateTaskStatus(ctx, taskID, "blocked")
			_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
				fmt.Sprintf("Task \"%s\" blocked: no deliverable produced after %d attempts.", taskTitle, maxEmptyRounds))
			delete(w.emptyRounds, taskID)
		}
	} else {
		// Task progressed (review or other) — reset counter
		delete(w.emptyRounds, taskID)
	}

	w.svc.TriggerCEOForProject(projectID)
}

// ─── Worker cycle logic ───────────────────────────────────────────────────────

// executeForEmployee runs the LLM for a worker task, processes tool calls, and sets task status
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

	// Mark task in_progress
	if err := w.svc.db.UpdateTaskStatus(ctx, taskID, "in_progress"); err != nil {
		return fmt.Errorf("update task in_progress: %w", err)
	}

	taskIDPtr := taskID

	// Load all project employees for ask_colleague
	employees, err := w.svc.db.GetProjectEmployees(ctx, projectID)
	if err != nil {
		return fmt.Errorf("load employees: %w", err)
	}

	// Run LLM
	result, err := w.svc.runtime.Run(ctx, agent.RunOptions{
		EmployeeID: employeeID,
		ProjectID:  projectID,
		TaskID:     &taskIDPtr,
		Tools:      tools.WorkerTools(),
	})
	if err != nil {
		return fmt.Errorf("worker LLM call: %w", err)
	}

	var reports []string
	hadDeliverableTool := false

	// Get project workspace root for execute_command
	projectWorkspaceRoot, _ := w.svc.workspace.ProjectRoot(projectID)

	// Process tool calls
	if len(result.ToolCalls) > 0 {
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
				reports = append(reports, fmt.Sprintf("[%s] 已保存%s → %s", strOrEmpty(&task.Task.Title), label, title))

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

				colResult, err := w.svc.runtime.Run(ctx, agent.RunOptions{
					EmployeeID: colleague.ID,
					ProjectID:  projectID,
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
	}

	// Fallback: if no tool deliverable, use text content
	if !hadDeliverableTool && result.Content != "" {
		hadDeliverableTool = true
		reports = append(reports, result.Content)
		if err := w.createFileAndNotify(ctx, projectID, employeeID, &taskIDPtr, task.Task.Title, result.Content, "document"); err != nil {
			return fmt.Errorf("fallback file: %w", err)
		}
	}

	// Update task status
	taskOutput := strings.Join(reports, "\n\n---\n\n")
	if taskOutput != "" && hadDeliverableTool {
		if err := w.svc.db.UpdateTaskOutput(ctx, taskID, "review", taskOutput); err != nil {
			return fmt.Errorf("update task review: %w", err)
		}
	} else {
		// No deliverable: keep assigned so worker loops again
		if err := w.svc.db.UpdateTaskStatus(ctx, taskID, "assigned"); err != nil {
			return fmt.Errorf("reset task assigned: %w", err)
		}
	}

	return nil
}

// createFileAndNotify creates a ProjectFile record and sends bus event
func (w *Worker) createFileAndNotify(ctx context.Context, projectID, employeeID string, taskID *string, title, content, fileType string) error {
	brief := content
	if len(brief) > 80 {
		brief = brief[:80] + "…"
	}

	taskIDForPath := ""
	if taskID != nil {
		taskIDForPath = *taskID
	}

	// Write to workspace (best effort; fall back to DB storage if it fails)
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
	w.svc.bus.Publish(bus.BusMessage{
		ID:          file.ID,
		ProjectID:   projectID,
		TaskID:      taskID,
		SenderID:    &senderID,
		SenderType:  "agent",
		MessageType: "deliverable",
		Content:     fmt.Sprintf("[agent] 已提交《%s》→ %s", title, tabLabel),
		Metadata:    map[string]interface{}{"fileId": file.ID, "brief": brief, "fileType": fileType},
		CreatedAt:   file.CreatedAt,
	})

	return nil
}

// executeCommand runs a shell command with timeout and path safety
func executeCommand(ctx context.Context, command, workdir, projectWorkspaceRoot string, timeout time.Duration) (string, int, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "/bin/sh", "-c", command)

	if projectWorkspaceRoot != "" {
		safeDir := projectWorkspaceRoot
		if workdir != "" {
			candidate := filepath.Join(projectWorkspaceRoot, workdir)
			abs, err := filepath.Abs(candidate)
			if err == nil && strings.HasPrefix(abs, projectWorkspaceRoot) {
				safeDir = abs
			}
		}
		cmd.Dir = safeDir
	}

	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &outBuf

	exitCode := 0
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			output := outBuf.String()
			if len(output) > maxCommandOutputBytes {
				output = output[:maxCommandOutputBytes] + "\n... (output truncated)"
			}
			return output, -1, err
		}
	}

	output := outBuf.String()
	if len(output) > maxCommandOutputBytes {
		output = output[:maxCommandOutputBytes] + "\n... (output truncated)"
	}
	return output, exitCode, nil
}

func summarizeCommand(cmd string) string {
	if len(cmd) > 60 {
		return cmd[:60] + "..."
	}
	return cmd
}
