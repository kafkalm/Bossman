package engine

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/cuid"
)

type WorkerCycleResult struct {
	EmptyRound    bool
	EnteredReview bool
}

type reviewSubmission struct {
	Summary      string
	Deliverables []string
	SelfCheck    string
}

// executeForEmployee runs one worker cycle for a task.
// EnteredReview becomes true only when worker explicitly submits and validation passes.
func (w *Worker) executeForEmployee(ctx context.Context, taskID string) (WorkerCycleResult, error) {
	task, err := w.svc.db.GetTask(ctx, taskID)
	if err != nil {
		return WorkerCycleResult{}, fmt.Errorf("load task: %w", err)
	}
	if task.AssigneeID == nil {
		return WorkerCycleResult{}, fmt.Errorf("task %s has no assigned employee", taskID)
	}

	projectID := task.Task.ProjectID
	employeeID := *task.AssigneeID
	initialStatus := normalizeTaskStatus(task.Status)
	if err := w.svc.TransitionTaskStatus(ctx, taskID, TaskStatusInProgress, "worker picked task", employeeID); err != nil {
		return WorkerCycleResult{}, fmt.Errorf("update task in_progress: %w", err)
	}

	taskIDPtr := taskID

	result, err := w.svc.Run(ctx, RunOptions{
		EmployeeID: employeeID,
		ProjectID:  projectID,
		Task:       &task.Task,
		Tools:      workerTools(),
	})
	if err != nil {
		return WorkerCycleResult{}, fmt.Errorf("worker LLM call: %w", err)
	}

	var reports []string
	hadFileOutput := false
	hadPlanArtifact := false
	emptyRound := false
	enteredReview := false
	var createdFiles []string
	var submission *reviewSubmission
	projectWorkspaceRoot, _ := w.svc.workspace.ProjectRoot(projectID)

	for _, tc := range result.ToolCalls {
		switch tc.Name {
		case "create_file", "save_to_workspace":
			hadFileOutput = true
			title, _ := tc.Args["title"].(string)
			if title == "" {
				title = "untitled"
			}
			content, _ := tc.Args["content"].(string)
			if tc.Name == "save_to_workspace" {
				normalizedTitle := strings.ToLower(title)
				normalizedContent := strings.ToLower(content)
				if strings.Contains(normalizedTitle, "plan") || strings.Contains(normalizedTitle, "outline") || strings.Contains(normalizedContent, "self-check") {
					hadPlanArtifact = true
				}
			}
			fileType := "code"
			if tc.Name == "save_to_workspace" {
				fileType = "document"
			}
			if ft, ok := tc.Args["fileType"].(string); ok && ft != "" {
				fileType = ft
			}
			relPath, err := w.createFileAndNotify(ctx, projectID, employeeID, &taskIDPtr, title, content, fileType)
			if err != nil {
				return WorkerCycleResult{}, fmt.Errorf("%s file: %w", tc.Name, err)
			}
			createdFiles = append(createdFiles, relPath)
			label := "文档"
			if fileType == "code" {
				label = "代码"
			}
			reports = append(reports, fmt.Sprintf("[%s] 已保存%s -> %s", strOrEmpty(&task.Task.Title), label, title))
		case "submit_for_review":
			summary, _ := tc.Args["summary"].(string)
			selfCheck, _ := tc.Args["self_check"].(string)
			submission = &reviewSubmission{
				Summary:      strings.TrimSpace(summary),
				SelfCheck:    strings.TrimSpace(selfCheck),
				Deliverables: parseStringArray(tc.Args["deliverables"]),
			}
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

	if !hadFileOutput && result.Content != "" {
		hadFileOutput = true
		reports = append(reports, result.Content)
		relPath, err := w.createFileAndNotify(ctx, projectID, employeeID, &taskIDPtr, task.Task.Title, result.Content, "document")
		if err != nil {
			return WorkerCycleResult{}, fmt.Errorf("fallback file: %w", err)
		}
		createdFiles = append(createdFiles, relPath)
	}
	if !hadFileOutput {
		emptyRound = true
		note := fmt.Sprintf("Progress note (%s): no concrete deliverable was produced this round; additional clarification or resources may be needed.", time.Now().Format(time.RFC3339))
		reports = append(reports, note)
		relPath, err := w.createFileAndNotify(ctx, projectID, employeeID, &taskIDPtr, task.Task.Title+"-progress-note", note, "document")
		if err != nil {
			return WorkerCycleResult{}, fmt.Errorf("progress note file: %w", err)
		}
		createdFiles = append(createdFiles, relPath)
	}
	if initialStatus == TaskStatusTodo && !hadPlanArtifact {
		reports = append(reports, "[Guardrail] first-cycle protocol violation: missing execution plan artifact in workspace.")
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskIDPtr,
			"[Guardrail] Worker did not save a first-cycle execution plan. Continue task execution and include a concrete plan artifact.")
	}

	taskOutput := buildWorkerProgressOutput(reports, createdFiles, emptyRound)
	if submission != nil {
		if err := w.validateReviewSubmission(ctx, projectID, employeeID, taskID, submission); err != nil {
			reports = append(reports, fmt.Sprintf("[Review submission rejected] %v", err))
			taskOutput = buildWorkerProgressOutput(reports, createdFiles, emptyRound)
		} else {
			taskOutput = buildWorkerReviewOutput(*submission)
			enteredReview = true
		}
	}
	if taskOutput != "" {
		if err := w.svc.db.SetTaskOutput(ctx, taskID, taskOutput); err != nil {
			return WorkerCycleResult{}, fmt.Errorf("set task output: %w", err)
		}
	}
	if enteredReview {
		if err := w.svc.TransitionTaskStatus(ctx, taskID, TaskStatusReview, "worker explicitly submitted for review", employeeID); err != nil {
			return WorkerCycleResult{}, fmt.Errorf("transition task review: %w", err)
		}
	}
	_ = w.svc.db.AddTimelineEvent(ctx, projectID, &taskIDPtr, "task.updated", employeeID,
		"worker cycle completed",
		map[string]interface{}{"toolCalls": len(result.ToolCalls), "emptyRound": emptyRound, "enteredReview": enteredReview, "createdFiles": len(createdFiles)})
	return WorkerCycleResult{EmptyRound: emptyRound, EnteredReview: enteredReview}, nil
}

// createFileAndNotify persists workspace output and emits a deliverable event.
func (w *Worker) createFileAndNotify(_ context.Context, projectID, employeeID string, taskID *string, title, content, fileType string) (string, error) {
	brief := content
	if len(brief) > 80 {
		brief = brief[:80] + "…"
	}
	taskIDForPath := ""
	if taskID != nil {
		taskIDForPath = *taskID
	}

	var wsErr error
	relPath := ""
	if taskIDForPath == "" {
		wsErr = fmt.Errorf("taskID is required for workspace output")
	} else {
		pathDir := taskIDForPath
		relPath, wsErr = w.svc.workspace.WriteFile(projectID, employeeID, &pathDir, title, content)
	}
	if wsErr != nil {
		return "", fmt.Errorf("workspace write required but failed: %w", wsErr)
	}
	tabLabel := "查看文档"
	if fileType == "code" {
		tabLabel = "查看代码"
	}
	senderID := employeeID
	w.svc.bus.Publish(bus.BusMessage{
		ID:          cuid.Generate(),
		ProjectID:   projectID,
		TaskID:      taskID,
		SenderID:    &senderID,
		SenderType:  "agent",
		MessageType: EngineEventTaskUpdated,
		Content:     fmt.Sprintf("[agent] 已提交《%s》-> %s", title, tabLabel),
		Metadata:    map[string]interface{}{"brief": brief, "fileType": fileType},
		CreatedAt:   time.Now(),
	})
	return relPath, nil
}

func parseStringArray(v interface{}) []string {
	if v == nil {
		return nil
	}
	switch vv := v.(type) {
	case []string:
		out := make([]string, 0, len(vv))
		for _, item := range vv {
			item = strings.TrimSpace(item)
			if item != "" {
				out = append(out, item)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(vv))
		for _, raw := range vv {
			s, ok := raw.(string)
			if !ok {
				continue
			}
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func buildWorkerProgressOutput(reports, files []string, emptyRound bool) string {
	var b strings.Builder
	b.WriteString("## Progress Update\n")
	if len(files) == 0 {
		b.WriteString("- Files: none\n")
	} else {
		b.WriteString("- Files:\n")
		for _, f := range files {
			b.WriteString(fmt.Sprintf("  - %s\n", f))
		}
	}
	b.WriteString("- Empty round: ")
	if emptyRound {
		b.WriteString("yes\n")
	} else {
		b.WriteString("no\n")
	}
	if len(reports) > 0 {
		b.WriteString("\n## Details\n")
		b.WriteString(strings.Join(reports, "\n\n---\n\n"))
	}
	return b.String()
}

func buildWorkerReviewOutput(submission reviewSubmission) string {
	var b strings.Builder
	b.WriteString("## Review Submission\n")
	b.WriteString("### Summary\n")
	b.WriteString(submission.Summary + "\n\n")
	b.WriteString("### Deliverables\n")
	for _, path := range submission.Deliverables {
		b.WriteString(fmt.Sprintf("- %s\n", path))
	}
	b.WriteString("\n### Self Check\n")
	b.WriteString(submission.SelfCheck)
	return b.String()
}

func (w *Worker) validateReviewSubmission(ctx context.Context, projectID, employeeID, taskID string, submission *reviewSubmission) error {
	if submission == nil {
		return fmt.Errorf("missing submission")
	}
	if submission.Summary == "" {
		return fmt.Errorf("summary is required")
	}
	if submission.SelfCheck == "" {
		return fmt.Errorf("self_check is required")
	}
	if len(submission.Deliverables) == 0 {
		return fmt.Errorf("deliverables must include at least one file")
	}
	prefix := filepath.ToSlash(filepath.Join(employeeID, taskID)) + "/"
	for _, raw := range submission.Deliverables {
		relativePath := filepath.ToSlash(strings.TrimSpace(raw))
		if relativePath == "" {
			return fmt.Errorf("deliverables contain empty path")
		}
		if !strings.HasPrefix(relativePath, prefix) {
			return fmt.Errorf("deliverable %q must be under worker task path %q", relativePath, prefix)
		}
		if _, err := w.svc.workspace.ReadFile(projectID, relativePath); err != nil {
			return fmt.Errorf("deliverable %q does not exist or is unreadable: %w", relativePath, err)
		}
	}
	return nil
}
