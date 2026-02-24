package engine

import (
	"context"
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

// ProjectSnapshot is a lightweight project runtime summary for API use.
type ProjectSnapshot struct {
	ProjectID              string                 `json:"projectId"`
	Status                 string                 `json:"status"`
	TaskCounts             map[string]int         `json:"taskCounts"`
	TotalTasks             int                    `json:"totalTasks"`
	ActiveWorkers          int                    `json:"activeWorkers"`
	LastProjectTransitions []db.ProjectTransition `json:"lastProjectTransitions"`
	LastTaskTransitions    []db.TaskTransition    `json:"lastTaskTransitions"`
}

// SnapshotProject returns a minimal runtime snapshot for a project.
func (s *Service) SnapshotProject(projectID string) (*ProjectSnapshot, error) {
	ctx := context.Background()
	project, err := s.db.GetProject(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}
	tasks, err := s.db.GetTasksForProject(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load tasks: %w", err)
	}
	counts := map[string]int{}
	for _, t := range tasks {
		counts[normalizeTaskStatus(t.Status)]++
	}

	employees, err := s.db.GetProjectEmployees(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("load employees: %w", err)
	}
	activeWorkers := 0
	for _, emp := range employees {
		if emp.RoleName == "ceo" {
			continue
		}
		if emp.Status == "busy" {
			activeWorkers++
		}
	}
	projectTransitions, _ := s.db.GetRecentProjectTransitions(ctx, projectID, 10)
	taskTransitions, _ := s.db.GetRecentTaskTransitions(ctx, projectID, 20)

	return &ProjectSnapshot{
		ProjectID:              projectID,
		Status:                 normalizeProjectStatus(project.Status),
		TaskCounts:             counts,
		TotalTasks:             len(tasks),
		ActiveWorkers:          activeWorkers,
		LastProjectTransitions: projectTransitions,
		LastTaskTransitions:    taskTransitions,
	}, nil
}
