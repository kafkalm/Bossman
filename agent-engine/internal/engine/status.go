package engine

import "log"

const (
	ProjectStatusPlanning   = "planning"
	ProjectStatusInProgress = "in_progress"
	ProjectStatusReview     = "review"
	ProjectStatusCompleted  = "completed"
	ProjectStatusFailed     = "failed"
	ProjectStatusCancelled  = "cancelled"
)

const (
	TaskStatusPending    = "pending"
	TaskStatusAssigned   = "assigned"
	TaskStatusInProgress = "in_progress"
	TaskStatusReview     = "review"
	TaskStatusCompleted  = "completed"
	TaskStatusBlocked    = "blocked"
)

// CanProjectTransition checks if project status change is valid.
func CanProjectTransition(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case ProjectStatusPlanning:
		return to == ProjectStatusInProgress || to == ProjectStatusFailed || to == ProjectStatusCancelled
	case ProjectStatusInProgress:
		return to == ProjectStatusReview || to == ProjectStatusFailed || to == ProjectStatusCancelled
	case ProjectStatusReview:
		return to == ProjectStatusInProgress || to == ProjectStatusCompleted || to == ProjectStatusFailed || to == ProjectStatusCancelled
	case ProjectStatusCompleted, ProjectStatusFailed, ProjectStatusCancelled:
		return false
	default:
		return false
	}
}

// CanTaskTransition checks if task status change is valid.
func CanTaskTransition(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case TaskStatusPending:
		return to == TaskStatusAssigned || to == TaskStatusBlocked
	case TaskStatusAssigned:
		return to == TaskStatusInProgress || to == TaskStatusBlocked
	case TaskStatusInProgress:
		return to == TaskStatusReview || to == TaskStatusAssigned || to == TaskStatusBlocked || to == TaskStatusCompleted
	case TaskStatusReview:
		return to == TaskStatusCompleted || to == TaskStatusInProgress || to == TaskStatusAssigned || to == TaskStatusBlocked
	case TaskStatusCompleted, TaskStatusBlocked:
		return false
	default:
		return false
	}
}

func validateProjectTransitionOrWarn(from, to, projectID string) {
	if !CanProjectTransition(from, to) {
		log.Printf("[engine] invalid project transition for %s: %s -> %s", projectID, from, to)
	}
}

func validateTaskTransitionOrWarn(from, to, taskID string) {
	if !CanTaskTransition(from, to) {
		log.Printf("[engine] invalid task transition for %s: %s -> %s", taskID, from, to)
	}
}
