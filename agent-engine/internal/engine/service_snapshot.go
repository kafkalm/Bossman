package engine

import (
	"context"
	"fmt"
)

// ProjectSnapshot is a lightweight project runtime summary for API use.
type ProjectSnapshot struct {
	ProjectID   string         `json:"projectId"`
	Status      string         `json:"status"`
	TaskCounts  map[string]int `json:"taskCounts"`
	TotalTasks  int            `json:"totalTasks"`
	HasCEO      bool           `json:"hasCeo"`
	FounderPing bool           `json:"founderPing"`
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
		counts[t.Status]++
	}

	s.mu.RLock()
	_, hasCEO := s.ceos[project.CompanyID]
	s.mu.RUnlock()
	_, founderPing := s.founderMessages.Load(projectID)

	return &ProjectSnapshot{
		ProjectID:   projectID,
		Status:      project.Status,
		TaskCounts:  counts,
		TotalTasks:  len(tasks),
		HasCEO:      hasCEO,
		FounderPing: founderPing,
	}, nil
}
