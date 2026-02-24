package engine

import (
	"context"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

func TestWorkerExecuteForEmployee_Table(t *testing.T) {
	tests := []struct {
		name         string
		llmResponse  *llm.LLMResponse
		expectStatus string
		expectOutput bool
	}{
		{
			name: "fallback content becomes deliverable",
			llmResponse: &llm.LLMResponse{Content: "draft output", ToolCalls: nil,
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus: TaskStatusReview,
			expectOutput: true,
		},
		{
			name: "no content keeps task assigned",
			llmResponse: &llm.LLMResponse{Content: "", ToolCalls: nil,
				Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"}},
			expectStatus: TaskStatusAssigned,
			expectOutput: false,
		},
	}

	for i, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			database := newTestDB(t)
			seedBasicProjectData(t, database)
			taskID := "task-worker-" + string(rune('a'+i))
			insertAssignedTask(t, database, taskID, TaskStatusAssigned, "")

			svc := newTestService(t, database, &fakeLLM{resp: tc.llmResponse})
			worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)

			if err := worker.executeForEmployee(context.Background(), taskID); err != nil {
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
		})
	}
}
