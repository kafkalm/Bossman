package engine

import "testing"

func TestCanProjectTransition_Table(t *testing.T) {
	tests := []struct {
		from string
		to   string
		ok   bool
	}{
		{ProjectStatusActive, ProjectStatusReview, true},
		{ProjectStatusActive, ProjectStatusPaused, true},
		{ProjectStatusReview, ProjectStatusPaused, true},
		{ProjectStatusPaused, ProjectStatusActive, true},
		{ProjectStatusPaused, ProjectStatusCanceled, true},
		{ProjectStatusReview, ProjectStatusDone, true},
		{ProjectStatusBlocked, ProjectStatusActive, true},
		{ProjectStatusDone, ProjectStatusActive, false},
		{ProjectStatusCanceled, ProjectStatusReview, false},
		{ProjectStatusPaused, ProjectStatusReview, false},
		{"in_progress", ProjectStatusReview, true},
		{"failed", ProjectStatusActive, true},
	}
	for _, tc := range tests {
		if got := CanProjectTransition(tc.from, tc.to); got != tc.ok {
			t.Fatalf("project transition %s->%s expected %v got %v", tc.from, tc.to, tc.ok, got)
		}
	}
}

func TestCanTaskTransition_Table(t *testing.T) {
	tests := []struct {
		from string
		to   string
		ok   bool
	}{
		{TaskStatusTodo, TaskStatusInProgress, true},
		{TaskStatusInProgress, TaskStatusReview, true},
		{TaskStatusReview, TaskStatusInProgress, true},
		{TaskStatusReview, TaskStatusTodo, true},
		{TaskStatusDone, TaskStatusTodo, false},
		{TaskStatusBlocked, TaskStatusTodo, true},
		{TaskStatusBlocked, TaskStatusInProgress, true},
		{"assigned", TaskStatusInProgress, true},
		{"pending", TaskStatusBlocked, false},
	}
	for _, tc := range tests {
		if got := CanTaskTransition(tc.from, tc.to); got != tc.ok {
			t.Fatalf("task transition %s->%s expected %v got %v", tc.from, tc.to, tc.ok, got)
		}
	}
}

func TestValidateTransitionErrors(t *testing.T) {
	if err := ValidateProjectTransition(ProjectStatusDone, ProjectStatusActive, "proj-1"); err == nil {
		t.Fatalf("expected project transition error")
	}
	if err := ValidateTaskTransition(TaskStatusDone, TaskStatusInProgress, "task-1"); err == nil {
		t.Fatalf("expected task transition error")
	}
}
