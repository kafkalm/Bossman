package engine

import "testing"

func TestCanProjectTransition_Table(t *testing.T) {
	tests := []struct {
		from string
		to   string
		ok   bool
	}{
		{ProjectStatusPlanning, ProjectStatusInProgress, true},
		{ProjectStatusInProgress, ProjectStatusReview, true},
		{ProjectStatusReview, ProjectStatusCompleted, true},
		{ProjectStatusCompleted, ProjectStatusInProgress, false},
		{ProjectStatusFailed, ProjectStatusReview, false},
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
		{TaskStatusAssigned, TaskStatusInProgress, true},
		{TaskStatusInProgress, TaskStatusReview, true},
		{TaskStatusReview, TaskStatusAssigned, true},
		{TaskStatusCompleted, TaskStatusAssigned, false},
		{TaskStatusBlocked, TaskStatusInProgress, false},
	}
	for _, tc := range tests {
		if got := CanTaskTransition(tc.from, tc.to); got != tc.ok {
			t.Fatalf("task transition %s->%s expected %v got %v", tc.from, tc.to, tc.ok, got)
		}
	}
}
