package engine

import (
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

func TestAllTasksActiveOrInProgress(t *testing.T) {
	assignee := "emp-1"

	tests := []struct {
		name  string
		tasks []db.TaskWithAssignment
		want  bool
	}{
		{
			name: "all assigned todo/in_progress",
			tasks: []db.TaskWithAssignment{
				{Task: db.Task{Status: TaskStatusTodo}, AssigneeID: &assignee},
				{Task: db.Task{Status: TaskStatusInProgress}, AssigneeID: &assignee},
			},
			want: true,
		},
		{
			name: "contains unassigned todo",
			tasks: []db.TaskWithAssignment{
				{Task: db.Task{Status: TaskStatusTodo}, AssigneeID: nil},
			},
			want: false,
		},
		{
			name: "contains review task",
			tasks: []db.TaskWithAssignment{
				{Task: db.Task{Status: TaskStatusTodo}, AssigneeID: &assignee},
				{Task: db.Task{Status: TaskStatusReview}, AssigneeID: &assignee},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := AllTasksActiveOrInProgress(tt.tasks)
			if got != tt.want {
				t.Fatalf("AllTasksActiveOrInProgress() = %v, want %v", got, tt.want)
			}
		})
	}
}

