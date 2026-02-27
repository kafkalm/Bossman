package engine

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/cuid"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

type WorkerCycleResult struct {
	EmptyRound    bool
	EnteredReview bool
	BecameBlocked bool
}

type reviewSubmission struct {
	Summary      string
	Deliverables []string
	SelfCheck    string
}

type planProgressReport struct {
	CompletedItems     []string
	InProgressItems    []string
	NextItems          []string
	BlockedItems       []string
	UpdatedPlanContent string
	Summary            string
}

type taskPlanContext struct {
	HasPlan            bool
	PlanFiles          []string
	PrimaryPlanFile    string
	PrimaryPlanContent string
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
	planCtx, err := w.loadTaskPlanContext(projectID, employeeID, taskID)
	if err != nil {
		return WorkerCycleResult{}, fmt.Errorf("detect workspace phase: %w", err)
	}
	hasPlanBefore := planCtx.HasPlan
	if err := w.svc.TransitionTaskStatus(ctx, taskID, TaskStatusInProgress, "worker picked task", employeeID); err != nil {
		return WorkerCycleResult{}, fmt.Errorf("update task in_progress: %w", err)
	}

	taskIDPtr := taskID

	result, err := w.svc.Run(ctx, RunOptions{
		EmployeeID: employeeID,
		ProjectID:  projectID,
		Task:       &task.Task,
		Tools:      workerTools(),
		AdditionalMessages: []llm.ChatMessage{
			{Role: "user", Content: buildPlanAwareAdditionalMessage(planCtx)},
		},
	})
	if err != nil {
		return WorkerCycleResult{}, fmt.Errorf("worker LLM call: %w", err)
	}

	var reports []string
	hadFileOutput := false
	planArtifactsThisRound := 0
	executionArtifactsThisRound := 0
	emptyRound := false
	enteredReview := false
	becameBlocked := false
	var createdFiles []string
	var createdPlanFiles []string
	var submission *reviewSubmission
	var planProgress *planProgressReport
	reportPlanProgressCallCount := 0
	projectWorkspaceRoot, _ := w.svc.workspace.ProjectRoot(projectID)
	planFileUsed := planCtx.PrimaryPlanFile

	for _, tc := range result.ToolCalls {
		switch tc.Name {
		case "create_file", "save_to_workspace":
			hadFileOutput = true
			title, _ := tc.Args["title"].(string)
			if title == "" {
				title = "untitled"
			}
			content, _ := tc.Args["content"].(string)
			if isPlanArtifact(title) {
				planArtifactsThisRound++
			} else if isExecutionArtifact(title) {
				executionArtifactsThisRound++
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
			if isPlanArtifact(title) {
				createdPlanFiles = append(createdPlanFiles, relPath)
			}
			label := "文档"
			if fileType == "code" {
				label = "代码"
			}
			reports = append(reports, fmt.Sprintf("[%s] 已保存%s -> %s", strOrEmpty(&task.Task.Title), label, title))
		case "report_plan_progress":
			reportPlanProgressCallCount++
			report, parseErr := extractPlanProgressToolCall(tc.Args)
			if parseErr != nil {
				reports = append(reports, fmt.Sprintf("[Plan Progress Rejected] %v", parseErr))
				continue
			}
			if planProgress == nil {
				planProgress = &report
			}
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

	reportErr := validatePlanProgress(hasPlanBefore, reportPlanProgressCallCount, planProgress, executionArtifactsThisRound)
	reportValid := reportErr == nil
	if reportErr != nil {
		reports = append(reports, fmt.Sprintf("[Guardrail] %v", reportErr))
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskIDPtr, fmt.Sprintf("[Guardrail] %v", reportErr))
	}

	if reportValid && planProgress != nil {
		if planFileUsed == "" {
			if candidate, ok := selectPrimaryPlanFromList(createdPlanFiles); ok {
				planFileUsed = candidate
			} else {
				planFileUsed = filepath.ToSlash(filepath.Join(employeeID, taskID, "plan.md"))
			}
		}
		savedPath, err := w.updatePrimaryPlanFile(projectID, employeeID, taskID, planFileUsed, planProgress.UpdatedPlanContent)
		if err != nil {
			return WorkerCycleResult{}, fmt.Errorf("update plan file: %w", err)
		}
		planFileUsed = savedPath
		if !containsString(createdFiles, savedPath) {
			createdFiles = append(createdFiles, savedPath)
		}
		hadFileOutput = true
		planArtifactsThisRound++
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

	if !hasPlanBefore && planArtifactsThisRound == 0 {
		reports = append(reports, "[Guardrail] plan phase violation: no plan file was saved. Create a concrete plan file (plan.md/outline.md/checklist.md) and update it via report_plan_progress.")
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskIDPtr,
			"[Guardrail] No plan file detected in this round. Save/update a concrete plan file before proceeding.")
	}

	if !hasPlanBefore {
		delete(w.planOnlyRounds, taskID)
	} else if executionArtifactsThisRound == 0 || !reportValid {
		w.planOnlyRounds[taskID]++
		reports = append(reports, fmt.Sprintf("[Guardrail] execution phase violation: missing non-plan progress (round %d/%d).", w.planOnlyRounds[taskID], maxPlanOnlyRounds))
	} else {
		delete(w.planOnlyRounds, taskID)
	}

	taskOutput := buildWorkerProgressOutput(reports, createdFiles, emptyRound, planFileUsed, planProgress)
	if submission != nil {
		if !hasPlanBefore {
			reports = append(reports, "[Review submission rejected] task is in plan phase; create plan first, then continue execution.")
			taskOutput = buildWorkerProgressOutput(reports, createdFiles, emptyRound, planFileUsed, planProgress)
		} else if !reportValid {
			reports = append(reports, "[Review submission rejected] report_plan_progress is required exactly once with valid updated_plan_content.")
			taskOutput = buildWorkerProgressOutput(reports, createdFiles, emptyRound, planFileUsed, planProgress)
		} else if executionArtifactsThisRound == 0 {
			reports = append(reports, "[Review submission rejected] execution phase requires at least one non-plan deliverable file this round.")
			taskOutput = buildWorkerProgressOutput(reports, createdFiles, emptyRound, planFileUsed, planProgress)
		} else if err := w.validateReviewSubmission(ctx, projectID, employeeID, taskID, submission); err != nil {
			reports = append(reports, fmt.Sprintf("[Review submission rejected] %v", err))
			taskOutput = buildWorkerProgressOutput(reports, createdFiles, emptyRound, planFileUsed, planProgress)
		} else {
			taskOutput = buildWorkerReviewOutput(*submission)
			enteredReview = true
		}
	}

	planOnlyRounds := w.planOnlyRounds[taskID]
	if hasPlanBefore && planOnlyRounds >= maxPlanOnlyRounds {
		reason := fmt.Sprintf("planning loop detected: %d rounds without execution artifacts", maxPlanOnlyRounds)
		if err := w.svc.TransitionTaskStatus(ctx, taskID, TaskStatusBlocked, reason, "worker:auto"); err == nil {
			becameBlocked = true
		}
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskIDPtr,
			fmt.Sprintf("[Auto-blocked] Task entered planning loop (%d rounds). Please revise task scope or provide clearer execution constraints.", maxPlanOnlyRounds))
		delete(w.planOnlyRounds, taskID)
		enteredReview = false
	}

	if taskOutput != "" {
		if err := w.svc.db.SetTaskOutput(ctx, taskID, taskOutput); err != nil {
			return WorkerCycleResult{}, fmt.Errorf("set task output: %w", err)
		}
	}
	if enteredReview && !becameBlocked {
		if err := w.svc.TransitionTaskStatus(ctx, taskID, TaskStatusReview, "worker explicitly submitted for review", employeeID); err != nil {
			return WorkerCycleResult{}, fmt.Errorf("transition task review: %w", err)
		}
	}
	_ = w.svc.db.AddTimelineEvent(ctx, projectID, &taskIDPtr, "task.updated", employeeID,
		"worker cycle completed",
		map[string]interface{}{
			"toolCalls":          len(result.ToolCalls),
			"emptyRound":         emptyRound,
			"enteredReview":      enteredReview,
			"createdFiles":       len(createdFiles),
			"hasPlanBefore":      hasPlanBefore,
			"planFile":           planFileUsed,
			"planArtifacts":      planArtifactsThisRound,
			"executionArtifacts": executionArtifactsThisRound,
			"planOnlyRounds":     planOnlyRounds,
			"becameBlocked":      becameBlocked,
			"completedItems":     safePlanArray(planProgress, func(p *planProgressReport) []string { return p.CompletedItems }),
			"inProgressItems":    safePlanArray(planProgress, func(p *planProgressReport) []string { return p.InProgressItems }),
			"nextItems":          safePlanArray(planProgress, func(p *planProgressReport) []string { return p.NextItems }),
			"blockedItems":       safePlanArray(planProgress, func(p *planProgressReport) []string { return p.BlockedItems }),
			"reportSummary":      safePlanText(planProgress, func(p *planProgressReport) string { return p.Summary }),
		})
	return WorkerCycleResult{EmptyRound: emptyRound, EnteredReview: enteredReview, BecameBlocked: becameBlocked}, nil
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

func buildPlanAwareAdditionalMessage(planCtx taskPlanContext) string {
	if !planCtx.HasPlan {
		return "Plan phase: No plan file exists in your task workspace yet. Create and save a concrete plan file now (e.g. plan.md / outline.md / checklist.md). In this round you MUST call report_plan_progress exactly once and provide updated_plan_content with the full plan content. Do not call submit_for_review in this phase."
	}
	var b strings.Builder
	b.WriteString("Execution phase: A plan file already exists for this task.\n")
	b.WriteString("You MUST produce at least one non-plan deliverable file this round.\n")
	b.WriteString("You MUST call report_plan_progress exactly once, include completed/in-progress/next/blocked items, and provide updated_plan_content as the FULL updated plan file content.\n")
	if planCtx.PrimaryPlanFile != "" {
		b.WriteString("Primary plan file: ")
		b.WriteString(planCtx.PrimaryPlanFile)
		b.WriteString("\n")
	}
	if len(planCtx.PlanFiles) > 0 {
		b.WriteString("Detected plan files: ")
		b.WriteString(strings.Join(planCtx.PlanFiles, ", "))
		b.WriteString("\n")
	}
	b.WriteString("Full plan content (authoritative):\n")
	b.WriteString("```markdown\n")
	b.WriteString(planCtx.PrimaryPlanContent)
	b.WriteString("\n```")
	return b.String()
}

func (w *Worker) loadTaskPlanContext(projectID, employeeID, taskID string) (taskPlanContext, error) {
	planFiles, err := w.listTaskPlanFiles(projectID, employeeID, taskID)
	if err != nil {
		return taskPlanContext{}, err
	}
	if len(planFiles) == 0 {
		return taskPlanContext{}, nil
	}
	primaryPlan, ok := selectPrimaryPlanFromList(planFiles)
	if !ok {
		return taskPlanContext{
			HasPlan:   true,
			PlanFiles: planFiles,
		}, nil
	}
	content, err := w.svc.workspace.ReadFile(projectID, primaryPlan)
	if err != nil {
		return taskPlanContext{}, fmt.Errorf("read primary plan %s: %w", primaryPlan, err)
	}
	return taskPlanContext{
		HasPlan:            true,
		PlanFiles:          planFiles,
		PrimaryPlanFile:    primaryPlan,
		PrimaryPlanContent: content,
	}, nil
}

func (w *Worker) listTaskPlanFiles(projectID, employeeID, taskID string) ([]string, error) {
	entries, err := w.svc.workspace.ListFiles(projectID)
	if err != nil {
		return nil, err
	}
	prefix := filepath.ToSlash(filepath.Join(employeeID, taskID)) + "/"
	planFiles := make([]string, 0, 2)
	for _, entry := range entries {
		relativePath := filepath.ToSlash(strings.TrimSpace(entry.RelativePath))
		if !strings.HasPrefix(relativePath, prefix) {
			continue
		}
		filename := filepath.Base(relativePath)
		if !isPlanFilename(filename) {
			continue
		}
		planFiles = append(planFiles, relativePath)
	}
	sort.Strings(planFiles)
	return planFiles, nil
}

func selectPrimaryPlanFromList(planFiles []string) (string, bool) {
	if len(planFiles) == 0 {
		return "", false
	}
	ordered := append([]string(nil), planFiles...)
	sort.SliceStable(ordered, func(i, j int) bool {
		pi := planPriority(ordered[i])
		pj := planPriority(ordered[j])
		if pi != pj {
			return pi < pj
		}
		return ordered[i] < ordered[j]
	})
	return ordered[0], true
}

func planPriority(path string) int {
	base := strings.ToLower(strings.TrimSpace(filepath.Base(path)))
	switch base {
	case "plan.md":
		return 0
	case "outline.md":
		return 1
	case "checklist.md":
		return 2
	default:
		return 3
	}
}

func extractPlanProgressToolCall(args map[string]interface{}) (planProgressReport, error) {
	report := planProgressReport{
		CompletedItems:  parseStringArray(args["completed_items"]),
		InProgressItems: parseStringArray(args["in_progress_items"]),
		NextItems:       parseStringArray(args["next_items"]),
		BlockedItems:    parseStringArray(args["blocked_items"]),
	}
	updatedPlanContent, _ := args["updated_plan_content"].(string)
	report.UpdatedPlanContent = strings.TrimSpace(updatedPlanContent)
	summary, _ := args["summary"].(string)
	report.Summary = strings.TrimSpace(summary)
	if report.UpdatedPlanContent == "" {
		return planProgressReport{}, fmt.Errorf("updated_plan_content is required and must not be empty")
	}
	if report.Summary == "" {
		return planProgressReport{}, fmt.Errorf("summary is required and must not be empty")
	}
	return report, nil
}

func validatePlanProgress(hasPlanBefore bool, reportCallCount int, report *planProgressReport, executionArtifactsThisRound int) error {
	if reportCallCount == 0 {
		return fmt.Errorf("missing mandatory report_plan_progress call")
	}
	if reportCallCount > 1 {
		return fmt.Errorf("report_plan_progress must be called exactly once, got %d", reportCallCount)
	}
	if report == nil {
		return fmt.Errorf("report_plan_progress payload is invalid")
	}
	if strings.TrimSpace(report.UpdatedPlanContent) == "" {
		return fmt.Errorf("updated_plan_content is required")
	}
	if hasPlanBefore {
		if executionArtifactsThisRound == 0 {
			return fmt.Errorf("execution phase requires at least one non-plan deliverable file")
		}
		if len(report.CompletedItems) == 0 && len(report.BlockedItems) == 0 {
			return fmt.Errorf("execution phase requires completed_items or blocked_items")
		}
	}
	return nil
}

func (w *Worker) updatePrimaryPlanFile(projectID, employeeID, taskID, planRelativePath, updatedContent string) (string, error) {
	targetFile := filepath.Base(strings.TrimSpace(planRelativePath))
	if targetFile == "" || targetFile == "." || targetFile == "/" {
		targetFile = "plan.md"
	}
	pathDir := taskID
	relPath, err := w.svc.workspace.WriteFile(projectID, employeeID, &pathDir, targetFile, updatedContent)
	if err != nil {
		return "", err
	}
	return relPath, nil
}

func isPlanFilename(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	if n == "" {
		return false
	}
	keywords := []string{"plan", "outline", "checklist", "self-check"}
	for _, kw := range keywords {
		if strings.Contains(n, kw) {
			return true
		}
	}
	return false
}

func isPlanArtifact(title string) bool {
	return isPlanFilename(title)
}

func isExecutionArtifact(title string) bool {
	return !isPlanArtifact(title)
}

func buildWorkerProgressOutput(reports, files []string, emptyRound bool, planFile string, planProgress *planProgressReport) string {
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
	if planFile != "" {
		b.WriteString("- Plan file: ")
		b.WriteString(planFile)
		b.WriteString("\n")
	}
	if planProgress != nil {
		b.WriteString("\n## Plan Progress\n")
		if strings.TrimSpace(planProgress.Summary) != "" {
			b.WriteString("- Summary: ")
			b.WriteString(planProgress.Summary)
			b.WriteString("\n")
		}
		writePlanList(&b, "Completed", planProgress.CompletedItems)
		writePlanList(&b, "In Progress", planProgress.InProgressItems)
		writePlanList(&b, "Next", planProgress.NextItems)
		writePlanList(&b, "Blocked", planProgress.BlockedItems)
	}
	if len(reports) > 0 {
		b.WriteString("\n## Details\n")
		b.WriteString(strings.Join(reports, "\n\n---\n\n"))
	}
	return b.String()
}

func writePlanList(b *strings.Builder, label string, items []string) {
	b.WriteString("- ")
	b.WriteString(label)
	b.WriteString(": ")
	if len(items) == 0 {
		b.WriteString("none\n")
		return
	}
	b.WriteString("\n")
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			continue
		}
		b.WriteString("  - ")
		b.WriteString(item)
		b.WriteString("\n")
	}
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

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func safePlanArray(report *planProgressReport, pick func(*planProgressReport) []string) []string {
	if report == nil {
		return nil
	}
	return pick(report)
}

func safePlanText(report *planProgressReport, pick func(*planProgressReport) string) string {
	if report == nil {
		return ""
	}
	return pick(report)
}
