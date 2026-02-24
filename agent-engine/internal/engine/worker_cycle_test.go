package engine

import (
	"context"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

func TestWorkerExecuteForEmployee_Table(t *testing.T) {
	tests := []struct {
		name               string
		llmResponse        *llm.LLMResponse
		expectStatus       string
		expectOutput       bool
		expectEnteredReview bool
	}{
		{
			name: "plan file only keeps in_progress",
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "save_to_workspace", Args: map[string]interface{}{"title": "plan.md", "content": "execution plan", "fileType": "document"}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus: TaskStatusInProgress,
			expectOutput: true,
			expectEnteredReview: false,
		},
		{
			name: "create_file without submit stays in_progress",
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "create_file", Args: map[string]interface{}{"title": "output.md", "content": "draft", "fileType": "document"}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus: TaskStatusInProgress,
			expectOutput: true,
			expectEnteredReview: false,
		},
		{
			name: "submit_for_review with existing file enters review",
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "create_file", Args: map[string]interface{}{"title": "final.md", "content": "final output", "fileType": "document"}},
				{Name: "submit_for_review", Args: map[string]interface{}{"summary": "done", "deliverables": []interface{}{"emp-dev/task-worker-c/final.md"}, "self_check": "all requirements covered"}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus: TaskStatusReview,
			expectOutput: true,
			expectEnteredReview: true,
		},
		{
			name: "submit_for_review with missing file stays in_progress",
			llmResponse: &llm.LLMResponse{ToolCalls: []llm.ToolCall{
				{Name: "submit_for_review", Args: map[string]interface{}{"summary": "done", "deliverables": []interface{}{"emp-dev/task-worker-d/not-found.md"}, "self_check": "checked"}},
			},
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus: TaskStatusInProgress,
			expectOutput: true,
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
