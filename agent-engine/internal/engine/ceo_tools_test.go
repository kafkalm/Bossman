package engine

import (
	"context"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

func TestCeoProcessToolCalls_Table(t *testing.T) {
	tests := []struct {
		name  string
		calls []llm.ToolCall
		check func(t *testing.T, database *db.DB, state *fakeRunState)
	}{
		{
			name: "assign_task creates task and wakes worker",
			calls: []llm.ToolCall{{Name: "assign_task", Args: map[string]interface{}{
				"roleName": "dev", "taskTitle": "Build", "taskDescription": "Do it", "priority": float64(8),
			}}},
			check: func(t *testing.T, database *db.DB, state *fakeRunState) {
				tasks, err := database.GetTasksForProject(context.Background(), "proj-1")
				if err != nil || len(tasks) != 1 {
					t.Fatalf("expected one task, err=%v len=%d", err, len(tasks))
				}
				if len(state.wakes) != 1 || state.wakes[0] != "emp-dev" {
					t.Fatalf("expected wake emp-dev, got %v", state.wakes)
				}
			},
		},
		{
			name: "update_project_status updates project",
			calls: []llm.ToolCall{{Name: "update_project_status", Args: map[string]interface{}{
				"status": ProjectStatusReview, "summary": "ready",
			}}},
			check: func(t *testing.T, database *db.DB, state *fakeRunState) {
				project, err := database.GetProject(context.Background(), "proj-1")
				if err != nil {
					t.Fatalf("load project: %v", err)
				}
				if project.Status != ProjectStatusReview {
					t.Fatalf("expected review, got %s", project.Status)
				}
			},
		},
		{
			name:  "approve_task marks completed",
			calls: []llm.ToolCall{{Name: "approve_task", Args: map[string]interface{}{"taskId": "task-approve", "comment": "ok"}}},
			check: func(t *testing.T, database *db.DB, state *fakeRunState) {
				if got := mustTaskStatus(t, database, "task-approve"); got != TaskStatusCompleted {
					t.Fatalf("expected completed, got %s", got)
				}
			},
		},
		{
			name:  "request_revision clears output and wakes assignee",
			calls: []llm.ToolCall{{Name: "request_revision", Args: map[string]interface{}{"taskId": "task-revise", "feedback": "more details"}}},
			check: func(t *testing.T, database *db.DB, state *fakeRunState) {
				if got := mustTaskStatus(t, database, "task-revise"); got != TaskStatusInProgress {
					t.Fatalf("expected in_progress, got %s", got)
				}
				if len(state.wakes) != 1 || state.wakes[0] != "emp-dev" {
					t.Fatalf("expected wake emp-dev, got %v", state.wakes)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			database := newTestDB(t)
			seedBasicProjectData(t, database)
			if tc.name == "approve_task marks completed" {
				insertAssignedTask(t, database, "task-approve", TaskStatusReview, "out")
			}
			if tc.name == "request_revision clears output and wakes assignee" {
				insertAssignedTask(t, database, "task-revise", TaskStatusReview, "out")
			}

			svc := newTestService(t, database, &fakeLLM{})
			ceo := NewCEO(db.EmployeeWithRole{Employee: db.Employee{ID: "emp-ceo", CompanyID: "comp-1", Name: "Alice"}, RoleName: "ceo"}, svc)
			state := &fakeRunState{projectID: "proj-1"}
			project, _ := database.GetProject(context.Background(), "proj-1")
			employees, _ := database.GetProjectEmployees(context.Background(), "proj-1")

			_, err := ceo.processToolCalls(context.Background(), state, project, employees, tc.calls)
			if err != nil {
				t.Fatalf("processToolCalls error: %v", err)
			}
			tc.check(t, database, state)
		})
	}
}
