package engine

import (
	"context"
	"strings"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

func TestWorkerExecuteForEmployee_Table(t *testing.T) {
	tests := []struct {
		name                string
		setupPlan           bool
		llmResponse         *llm.LLMResponse
		expectStatus        string
		expectOutput        bool
		expectEnteredReview bool
	}{
		{
			name:      "plan file only keeps in_progress",
			setupPlan: false,
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "save_to_workspace", Args: map[string]interface{}{"title": "plan.md", "content": "execution plan", "fileType": "document"}},
				{Name: "report_plan_progress", Args: map[string]interface{}{
					"completed_items":      []interface{}{"initial planning completed"},
					"in_progress_items":    []interface{}{"break down milestones"},
					"next_items":           []interface{}{"implement first milestone"},
					"blocked_items":        []interface{}{},
					"updated_plan_content": "# Plan\n- [x] initial planning completed\n- [ ] implement first milestone",
					"summary":              "created initial plan",
				}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus:        TaskStatusInProgress,
			expectOutput:        true,
			expectEnteredReview: false,
		},
		{
			name:      "create_file without submit stays in_progress",
			setupPlan: true,
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "create_file", Args: map[string]interface{}{"title": "output.md", "content": "draft", "fileType": "document"}},
				{Name: "report_plan_progress", Args: map[string]interface{}{
					"completed_items":      []interface{}{"wrote output draft"},
					"in_progress_items":    []interface{}{"polish final content"},
					"next_items":           []interface{}{"run self-check"},
					"blocked_items":        []interface{}{},
					"updated_plan_content": "# Plan\n- [x] wrote output draft\n- [ ] polish final content",
					"summary":              "execution progressing",
				}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus:        TaskStatusInProgress,
			expectOutput:        true,
			expectEnteredReview: false,
		},
		{
			name:      "submit_for_review with existing file enters review",
			setupPlan: true,
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "create_file", Args: map[string]interface{}{"title": "final.md", "content": "final output", "fileType": "document"}},
				{Name: "report_plan_progress", Args: map[string]interface{}{
					"completed_items":      []interface{}{"implemented final deliverable"},
					"in_progress_items":    []interface{}{},
					"next_items":           []interface{}{},
					"blocked_items":        []interface{}{},
					"updated_plan_content": "# Plan\n- [x] implemented final deliverable",
					"summary":              "all planned work completed",
				}},
				{Name: "submit_for_review", Args: map[string]interface{}{"summary": "done", "deliverables": []interface{}{"emp-dev/task-worker-c/final.md"}, "self_check": "all requirements covered"}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus:        TaskStatusReview,
			expectOutput:        true,
			expectEnteredReview: true,
		},
		{
			name:      "submit_for_review with missing file stays in_progress",
			setupPlan: true,
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "report_plan_progress", Args: map[string]interface{}{
					"completed_items":      []interface{}{"prepared final package"},
					"in_progress_items":    []interface{}{},
					"next_items":           []interface{}{},
					"blocked_items":        []interface{}{},
					"updated_plan_content": "# Plan\n- [x] prepared final package",
					"summary":              "ready to submit",
				}},
				{Name: "submit_for_review", Args: map[string]interface{}{"summary": "done", "deliverables": []interface{}{"emp-dev/task-worker-d/not-found.md"}, "self_check": "checked"}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus:        TaskStatusInProgress,
			expectOutput:        true,
			expectEnteredReview: false,
		},
	}

	for i, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			database := newTestDB(t)
			seedBasicProjectData(t, database)
			taskID := "task-worker-" + string(rune('a'+i))
			insertAssignedTask(t, database, taskID, TaskStatusTodo, "")

			svc := newTestService(t, database, &fakeLLM{resp: tc.llmResponse})
			worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)
			if tc.setupPlan {
				pathDir := taskID
				if _, err := svc.workspace.WriteFile("proj-1", "emp-dev", &pathDir, "plan.md", "existing plan"); err != nil {
					t.Fatalf("seed plan file: %v", err)
				}
			}

			result, err := worker.executeForEmployee(context.Background(), taskID)
			if err != nil {
				t.Fatalf("executeForEmployee error: %v", err)
			}
			task, err := database.GetTask(context.Background(), taskID)
			if err != nil {
				t.Fatalf("load task: %v", err)
			}
			if task.Status != tc.expectStatus {
				t.Fatalf("expected status %s, got %s", tc.expectStatus, task.Status)
			}
			if tc.expectOutput && (task.Output == nil || *task.Output == "") {
				t.Fatalf("expected output to be set")
			}
			if !tc.expectOutput && task.Output != nil {
				t.Fatalf("expected no output, got %q", *task.Output)
			}
			if result.EnteredReview != tc.expectEnteredReview {
				t.Fatalf("expected enteredReview=%v, got %v", tc.expectEnteredReview, result.EnteredReview)
			}
		})
	}
}

func TestWorkerExecuteForEmployee_PlanOnlyLoopBlocksAfterThreshold(t *testing.T) {
	database := newTestDB(t)
	seedBasicProjectData(t, database)
	taskID := "task-plan-loop"
	insertAssignedTask(t, database, taskID, TaskStatusTodo, "")

	llmResp := &llm.LLMResponse{
		ToolCalls: []llm.ToolCall{
			{Name: "save_to_workspace", Args: map[string]interface{}{"title": "plan.md", "content": "refined plan", "fileType": "document"}},
			{Name: "report_plan_progress", Args: map[string]interface{}{
				"completed_items":      []interface{}{},
				"in_progress_items":    []interface{}{"refine plan"},
				"next_items":           []interface{}{"start implementation"},
				"blocked_items":        []interface{}{},
				"updated_plan_content": "# Plan\n- [ ] start implementation",
				"summary":              "refined planning",
			}},
		},
		Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
	}
	svc := newTestService(t, database, &fakeLLM{resp: llmResp})
	worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)

	// Seed an existing plan to force execution phase from round 1.
	pathDir := taskID
	if _, err := svc.workspace.WriteFile("proj-1", "emp-dev", &pathDir, "plan.md", "existing plan"); err != nil {
		t.Fatalf("seed plan file: %v", err)
	}

	for round := 1; round <= maxPlanOnlyRounds; round++ {
		result, err := worker.executeForEmployee(context.Background(), taskID)
		if err != nil {
			t.Fatalf("round %d executeForEmployee error: %v", round, err)
		}
		if round < maxPlanOnlyRounds {
			if got := mustTaskStatus(t, database, taskID); got != TaskStatusInProgress {
				t.Fatalf("round %d expected in_progress, got %s", round, got)
			}
			if got := worker.planOnlyRounds[taskID]; got != round {
				t.Fatalf("round %d expected planOnlyRounds=%d, got %d", round, round, got)
			}
		} else {
			if !result.BecameBlocked {
				t.Fatalf("round %d expected BecameBlocked=true", round)
			}
			if got := mustTaskStatus(t, database, taskID); got != TaskStatusBlocked {
				t.Fatalf("round %d expected blocked, got %s", round, got)
			}
			if got := worker.planOnlyRounds[taskID]; got != 0 {
				t.Fatalf("round %d expected planOnlyRounds reset, got %d", round, got)
			}
		}
	}
}

func TestWorkerExecuteForEmployee_ExecutionPhaseWithoutReportIsViolation(t *testing.T) {
	database := newTestDB(t)
	seedBasicProjectData(t, database)
	taskID := "task-missing-report"
	insertAssignedTask(t, database, taskID, TaskStatusTodo, "")

	fake := &fakeLLM{resp: &llm.LLMResponse{
		ToolCalls: []llm.ToolCall{
			{Name: "create_file", Args: map[string]interface{}{"title": "deliverable.md", "content": "done", "fileType": "document"}},
		},
		Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
	}}
	svc := newTestService(t, database, fake)
	worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)

	pathDir := taskID
	if _, err := svc.workspace.WriteFile("proj-1", "emp-dev", &pathDir, "plan.md", "existing plan"); err != nil {
		t.Fatalf("seed plan file: %v", err)
	}

	if _, err := worker.executeForEmployee(context.Background(), taskID); err != nil {
		t.Fatalf("executeForEmployee error: %v", err)
	}
	task, err := database.GetTask(context.Background(), taskID)
	if err != nil {
		t.Fatalf("load task: %v", err)
	}
	if task.Status != TaskStatusInProgress {
		t.Fatalf("expected in_progress, got %s", task.Status)
	}
	if task.Output == nil || !strings.Contains(*task.Output, "missing mandatory report_plan_progress call") {
		t.Fatalf("expected output to mention missing report_plan_progress")
	}
	if got := worker.planOnlyRounds[taskID]; got != 1 {
		t.Fatalf("expected planOnlyRounds=1, got %d", got)
	}
}

func TestWorkerExecuteForEmployee_InjectsPrimaryPlanContentAndUpdatesPlan(t *testing.T) {
	database := newTestDB(t)
	seedBasicProjectData(t, database)
	taskID := "task-plan-injection"
	insertAssignedTask(t, database, taskID, TaskStatusTodo, "")

	fake := &fakeLLM{resp: &llm.LLMResponse{
		ToolCalls: []llm.ToolCall{
			{Name: "create_file", Args: map[string]interface{}{"title": "deliverable.md", "content": "implementation", "fileType": "document"}},
			{Name: "report_plan_progress", Args: map[string]interface{}{
				"completed_items":      []interface{}{"implemented feature"},
				"in_progress_items":    []interface{}{},
				"next_items":           []interface{}{"run tests"},
				"blocked_items":        []interface{}{},
				"updated_plan_content": "# Updated Plan\n- [x] implemented feature\n- [ ] run tests",
				"summary":              "implementation complete",
			}},
		},
		Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
	}}
	svc := newTestService(t, database, fake)
	worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)

	pathDir := taskID
	if _, err := svc.workspace.WriteFile("proj-1", "emp-dev", &pathDir, "outline.md", "# Outline\n- old"); err != nil {
		t.Fatalf("seed outline: %v", err)
	}
	if _, err := svc.workspace.WriteFile("proj-1", "emp-dev", &pathDir, "plan.md", "# Plan\n- old"); err != nil {
		t.Fatalf("seed plan: %v", err)
	}

	if _, err := worker.executeForEmployee(context.Background(), taskID); err != nil {
		t.Fatalf("executeForEmployee error: %v", err)
	}

	joined := joinChatMessages(fake.lastMessages)
	if !strings.Contains(joined, "Primary plan file: emp-dev/"+taskID+"/plan.md") {
		t.Fatalf("expected injected primary plan file path, got:\n%s", joined)
	}
	if !strings.Contains(joined, "# Plan\n- old") {
		t.Fatalf("expected full plan content injected into additional messages, got:\n%s", joined)
	}

	updatedPlan, err := svc.workspace.ReadFile("proj-1", "emp-dev/"+taskID+"/plan.md")
	if err != nil {
		t.Fatalf("read updated plan: %v", err)
	}
	if !strings.Contains(updatedPlan, "# Updated Plan") {
		t.Fatalf("expected plan.md updated by report_plan_progress, got:\n%s", updatedPlan)
	}
}

func TestWorkerExecuteForEmployee_EndToEndPlanExecuteReviewFlow(t *testing.T) {
	database := newTestDB(t)
	seedBasicProjectData(t, database)
	taskID := "task-e2e-flow"
	insertAssignedTask(t, database, taskID, TaskStatusTodo, "")

	planV1 := "# Plan\n- [x] analyze requirements\n- [ ] implement feature\n- [ ] verify output"
	planV2 := "# Plan\n- [x] analyze requirements\n- [x] implement feature\n- [ ] verify output"
	planV3 := "# Plan\n- [x] analyze requirements\n- [x] implement feature\n- [x] verify output"

	fake := &fakeLLM{
		responses: []*llm.LLMResponse{
			{
				ToolCalls: []llm.ToolCall{
					{Name: "save_to_workspace", Args: map[string]interface{}{"title": "plan.md", "content": "# Draft plan", "fileType": "document"}},
					{Name: "report_plan_progress", Args: map[string]interface{}{
						"completed_items":      []interface{}{"analyze requirements"},
						"in_progress_items":    []interface{}{"break implementation steps"},
						"next_items":           []interface{}{"implement feature"},
						"blocked_items":        []interface{}{},
						"updated_plan_content": planV1,
						"summary":              "initial plan created",
					}},
				},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
			},
			{
				ToolCalls: []llm.ToolCall{
					{Name: "create_file", Args: map[string]interface{}{"title": "feature.md", "content": "implemented feature output", "fileType": "document"}},
					{Name: "report_plan_progress", Args: map[string]interface{}{
						"completed_items":      []interface{}{"implement feature"},
						"in_progress_items":    []interface{}{"self-check output"},
						"next_items":           []interface{}{"verify output"},
						"blocked_items":        []interface{}{},
						"updated_plan_content": planV2,
						"summary":              "feature implementation completed",
					}},
				},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
			},
			{
				ToolCalls: []llm.ToolCall{
					{Name: "create_file", Args: map[string]interface{}{"title": "final.md", "content": "final verified deliverable", "fileType": "document"}},
					{Name: "report_plan_progress", Args: map[string]interface{}{
						"completed_items":      []interface{}{"verify output"},
						"in_progress_items":    []interface{}{},
						"next_items":           []interface{}{},
						"blocked_items":        []interface{}{},
						"updated_plan_content": planV3,
						"summary":              "verification complete, ready for review",
					}},
					{Name: "submit_for_review", Args: map[string]interface{}{
						"summary":      "task completed end-to-end",
						"deliverables": []interface{}{"emp-dev/task-e2e-flow/final.md"},
						"self_check":   "all requirements satisfied and verified",
					}},
				},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
			},
		},
	}
	svc := newTestService(t, database, fake)
	worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)

	round1, err := worker.executeForEmployee(context.Background(), taskID)
	if err != nil {
		t.Fatalf("round1 executeForEmployee error: %v", err)
	}
	if round1.EnteredReview {
		t.Fatalf("round1 should not enter review")
	}
	if got := mustTaskStatus(t, database, taskID); got != TaskStatusInProgress {
		t.Fatalf("round1 expected in_progress, got %s", got)
	}
	gotPlanV1, err := svc.workspace.ReadFile("proj-1", "emp-dev/"+taskID+"/plan.md")
	if err != nil {
		t.Fatalf("round1 read plan.md: %v", err)
	}
	if gotPlanV1 != planV1 {
		t.Fatalf("round1 expected plan content to be updated")
	}

	round2, err := worker.executeForEmployee(context.Background(), taskID)
	if err != nil {
		t.Fatalf("round2 executeForEmployee error: %v", err)
	}
	if round2.EnteredReview {
		t.Fatalf("round2 should not enter review")
	}
	if got := mustTaskStatus(t, database, taskID); got != TaskStatusInProgress {
		t.Fatalf("round2 expected in_progress, got %s", got)
	}
	gotPlanV2, err := svc.workspace.ReadFile("proj-1", "emp-dev/"+taskID+"/plan.md")
	if err != nil {
		t.Fatalf("round2 read plan.md: %v", err)
	}
	if gotPlanV2 != planV2 {
		t.Fatalf("round2 expected plan content to be updated")
	}

	round3, err := worker.executeForEmployee(context.Background(), taskID)
	if err != nil {
		t.Fatalf("round3 executeForEmployee error: %v", err)
	}
	if !round3.EnteredReview {
		t.Fatalf("round3 should enter review")
	}
	if got := mustTaskStatus(t, database, taskID); got != TaskStatusReview {
		t.Fatalf("round3 expected review, got %s", got)
	}
	gotPlanV3, err := svc.workspace.ReadFile("proj-1", "emp-dev/"+taskID+"/plan.md")
	if err != nil {
		t.Fatalf("round3 read plan.md: %v", err)
	}
	if gotPlanV3 != planV3 {
		t.Fatalf("round3 expected plan content to be updated")
	}
	if _, err := svc.workspace.ReadFile("proj-1", "emp-dev/"+taskID+"/final.md"); err != nil {
		t.Fatalf("round3 final deliverable should exist: %v", err)
	}

	task, err := database.GetTask(context.Background(), taskID)
	if err != nil {
		t.Fatalf("load task: %v", err)
	}
	if task.Output == nil || !strings.Contains(*task.Output, "## Review Submission") {
		t.Fatalf("expected review submission output, got: %v", task.Output)
	}

	if fake.callCount != 3 || len(fake.messagesByCall) != 3 {
		t.Fatalf("expected 3 llm calls, got callCount=%d messagesByCall=%d", fake.callCount, len(fake.messagesByCall))
	}
	if msg2 := joinChatMessages(fake.messagesByCall[1]); !strings.Contains(msg2, planV1) {
		t.Fatalf("round2 should receive full planV1 content in additional messages")
	}
	if msg3 := joinChatMessages(fake.messagesByCall[2]); !strings.Contains(msg3, planV2) {
		t.Fatalf("round3 should receive full planV2 content in additional messages")
	}
}

func joinChatMessages(messages []llm.ChatMessage) string {
	var b strings.Builder
	for _, m := range messages {
		b.WriteString(m.Role)
		b.WriteString(": ")
		b.WriteString(m.Content)
		b.WriteString("\n")
	}
	return b.String()
}
