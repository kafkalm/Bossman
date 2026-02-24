package engine

import (
	"context"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

func TestWorkerExecuteTask_TriggerCEOOnlyOnReview(t *testing.T) {
	t.Run("in_progress cycle should not trigger CEO", func(t *testing.T) {
		database := newTestDB(t)
		seedBasicProjectData(t, database)
		insertAssignedTask(t, database, "task-progress", TaskStatusTodo, "")

		svc := newTestService(t, database, &fakeLLM{resp: &llm.LLMResponse{
			ToolCalls: []llm.ToolCall{
				{Name: "save_to_workspace", Args: map[string]interface{}{"title": "plan.md", "content": "plan", "fileType": "document"}},
			},
			Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
		}})
		ceo := &CEO{companyID: "comp-1", trigger: make(chan string, 8)}
		svc.ceos["comp-1"] = ceo
		worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)

		worker.executeTask(context.Background(), &db.Task{ID: "task-progress", Title: "Task task-progress"}, "proj-1")

		if got := len(ceo.trigger); got != 0 {
			t.Fatalf("expected CEO not triggered, got %d", got)
		}
		if got := mustTaskStatus(t, database, "task-progress"); got != TaskStatusInProgress {
			t.Fatalf("expected in_progress, got %s", got)
		}
	})

	t.Run("review submission should trigger CEO", func(t *testing.T) {
		database := newTestDB(t)
		seedBasicProjectData(t, database)
		insertAssignedTask(t, database, "task-review", TaskStatusTodo, "")

		svc := newTestService(t, database, &fakeLLM{resp: &llm.LLMResponse{
			ToolCalls: []llm.ToolCall{
				{Name: "create_file", Args: map[string]interface{}{"title": "final.md", "content": "done", "fileType": "document"}},
				{Name: "submit_for_review", Args: map[string]interface{}{"summary": "done", "deliverables": []interface{}{"emp-dev/task-review/final.md"}, "self_check": "ok"}},
			},
			Usage: llm.TokenUsageInfo{Model: "gpt", Provider: "openai"},
		}})
		ceo := &CEO{companyID: "comp-1", trigger: make(chan string, 8)}
		svc.ceos["comp-1"] = ceo
		worker := NewWorker(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-dev", CompanyID: "comp-1", Name: "Bob"}, RoleName: "dev"}, svc)

		worker.executeTask(context.Background(), &db.Task{ID: "task-review", Title: "Task task-review"}, "proj-1")

		if got := len(ceo.trigger); got != 1 {
			t.Fatalf("expected CEO triggered once, got %d", got)
		}
		if got := mustTaskStatus(t, database, "task-review"); got != TaskStatusReview {
			t.Fatalf("expected review, got %s", got)
		}
	})
}

