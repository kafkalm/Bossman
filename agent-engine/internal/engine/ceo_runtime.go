package engine

import (
	"context"
	"log"
	"time"
)

// Loop is the main goroutine entry point for a CEO. Runs until ctx is cancelled.
func (c *CEO) Loop(ctx context.Context) error {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case projectID := <-c.trigger:
			c.runOneCeoCycle(ctx, projectID)
		case <-ticker.C:
			projectIDs, err := c.svc.db.GetInProgressProjectIDsByCompany(ctx, c.companyID)
			if err != nil {
				continue
			}
			for _, projectID := range projectIDs {
				c.runOneCeoCycle(ctx, projectID)
				break // one project per tick to avoid starving others
			}
		}
	}
}

// TriggerProject sends a non-blocking project trigger to this CEO.
func (c *CEO) TriggerProject(projectID string) {
	select {
	case c.trigger <- projectID:
	default:
	}
}

func (c *CEO) runOneCeoCycle(ctx context.Context, projectID string) {
	project, err := c.svc.db.GetProject(ctx, projectID)
	if err != nil {
		log.Printf("[CEO %s] load project error: %v", projectID, err)
		return
	}
	if project.Status != ProjectStatusInProgress {
		return
	}

	founderMessage := c.svc.takeFounderMessage(projectID)
	runState := &projectRunState{svc: c.svc, ceo: c, projectID: projectID}

	iter := c.iterations[projectID]
	if iter > maxCeoIterations-1 {
		iter = maxCeoIterations - 1
	}

	result, err := c.runCycle(ctx, CeoCycleRequest{
		Project:        project,
		RunState:       runState,
		Iteration:      iter,
		MaxIterations:  maxCeoIterations,
		FounderMessage: founderMessage,
	})
	if err != nil {
		log.Printf("[CEO %s] cycle error (iter %d): %v", projectID, c.iterations[projectID], err)
		return
	}

	c.iterations[projectID]++
	if result.ShouldStop {
		c.svc.StopProject(projectID)
		return
	}
	if result.Skipped {
		time.AfterFunc(30*time.Second, func() { c.TriggerProject(projectID) })
		return
	}

	projectAfter, err := c.svc.db.GetProject(ctx, projectID)
	if err == nil && (projectAfter.Status == ProjectStatusCompleted || projectAfter.Status == ProjectStatusFailed) {
		return
	}

	tasks, _ := c.svc.db.GetTasksForProject(ctx, projectID)
	if shouldSelfTrigger(result, tasks) {
		c.TriggerProject(projectID)
	}
}
