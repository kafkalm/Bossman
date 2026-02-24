package engine

import "fmt"

const (
	ProjectStatusActive   = "active"
	ProjectStatusReview   = "review"
	ProjectStatusPaused   = "paused"
	ProjectStatusDone     = "done"
	ProjectStatusBlocked  = "blocked"
	ProjectStatusCanceled = "canceled"
)

const (
	TaskStatusTodo       = "todo"
	TaskStatusInProgress = "in_progress"
	TaskStatusReview     = "review"
	TaskStatusDone       = "done"
	TaskStatusBlocked    = "blocked"
	TaskStatusCanceled   = "canceled"
)

const ErrCodeInvalidStateTransition = "invalid_state_transition"

type StateTransitionError struct {
	Code       string
	EntityType string
	EntityID   string
	From       string
	To         string
}

func (e *StateTransitionError) Error() string {
	return fmt.Sprintf("%s: %s %s cannot transition from %s to %s", e.Code, e.EntityType, e.EntityID, e.From, e.To)
}

func newTransitionError(entityType, entityID, from, to string) error {
	return &StateTransitionError{
		Code:       ErrCodeInvalidStateTransition,
		EntityType: entityType,
		EntityID:   entityID,
		From:       from,
		To:         to,
	}
}

func normalizeProjectStatus(status string) string {
	switch status {
	case "planning", "in_progress":
		return ProjectStatusActive
	case "completed":
		return ProjectStatusDone
	case "failed":
		return ProjectStatusBlocked
	case "cancelled":
		return ProjectStatusCanceled
	default:
		return status
	}
}

func normalizeTaskStatus(status string) string {
	switch status {
	case "created", "ready", "pending", "assigned":
		return TaskStatusTodo
	case "completed":
		return TaskStatusDone
	case "cancelled":
		return TaskStatusCanceled
	default:
		return status
	}
}

// CanProjectTransition checks if project status change is valid.
func CanProjectTransition(from, to string) bool {
	from = normalizeProjectStatus(from)
	to = normalizeProjectStatus(to)
	if from == to {
		return true
	}
	switch from {
	case ProjectStatusActive:
		return to == ProjectStatusReview || to == ProjectStatusPaused || to == ProjectStatusBlocked || to == ProjectStatusCanceled
	case ProjectStatusReview:
		return to == ProjectStatusActive || to == ProjectStatusPaused || to == ProjectStatusDone || to == ProjectStatusBlocked
	case ProjectStatusPaused:
		return to == ProjectStatusActive || to == ProjectStatusCanceled
	case ProjectStatusBlocked:
		return to == ProjectStatusActive || to == ProjectStatusCanceled
	case ProjectStatusDone, ProjectStatusCanceled:
		return false
	default:
		return false
	}
}

// CanTaskTransition checks if task status change is valid.
func CanTaskTransition(from, to string) bool {
	from = normalizeTaskStatus(from)
	to = normalizeTaskStatus(to)
	if from == to {
		return true
	}
	switch from {
	case TaskStatusTodo:
		return to == TaskStatusInProgress
	case TaskStatusInProgress:
		return to == TaskStatusReview || to == TaskStatusBlocked || to == TaskStatusCanceled
	case TaskStatusReview:
		return to == TaskStatusDone || to == TaskStatusInProgress || to == TaskStatusTodo || to == TaskStatusBlocked
	case TaskStatusBlocked:
		return to == TaskStatusTodo || to == TaskStatusInProgress || to == TaskStatusCanceled
	case TaskStatusDone, TaskStatusCanceled:
		return false
	default:
		return false
	}
}

func ValidateProjectTransition(from, to, projectID string) error {
	if CanProjectTransition(from, to) {
		return nil
	}
	return newTransitionError("project", projectID, normalizeProjectStatus(from), normalizeProjectStatus(to))
}

func ValidateTaskTransition(from, to, taskID string) error {
	if CanTaskTransition(from, to) {
		return nil
	}
	return newTransitionError("task", taskID, normalizeTaskStatus(from), normalizeTaskStatus(to))
}
