package engine

import (
	"context"
	"log"
	"strings"
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
			if len(projectIDs) == 0 {
				_ = c.svc.db.SetEmployeeStatus(ctx, c.id, "idle")
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
	if normalizeProjectStatus(project.Status) != ProjectStatusActive && normalizeProjectStatus(project.Status) != ProjectStatusReview {
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
	if result.NoActionInReview {
		c.reviewNoActionRuns[projectID]++
		if c.reviewNoActionRuns[projectID] >= 2 {
			if c.forceReviewProgress(ctx, runState, projectID) {
				c.reviewNoActionRuns[projectID] = 0
				c.TriggerProject(projectID)
				return
			}
		}
	} else {
		c.reviewNoActionRuns[projectID] = 0
	}

	if result.ShouldStop {
		c.svc.StopProject(projectID)
		return
	}
	if result.Skipped {
		time.AfterFunc(30*time.Second, func() { c.TriggerProject(projectID) })
		return
	}

	projectAfter, err := c.svc.db.GetProject(ctx, projectID)
	if err == nil {
		status := normalizeProjectStatus(projectAfter.Status)
		if status == ProjectStatusDone || status == ProjectStatusBlocked || status == ProjectStatusCanceled {
			return
		}
	}

	tasks, _ := c.svc.db.GetTasksForProject(ctx, projectID)
	if shouldSelfTrigger(result, tasks) {
		c.TriggerProject(projectID)
	}
}

// forceReviewProgress applies a deterministic fallback when CEO repeatedly produces no
// tool actions while tasks are stuck in review.
func (c *CEO) forceReviewProgress(ctx context.Context, runState ProjectRunState, projectID string) bool {
	tasks, err := c.svc.db.GetTasksForProject(ctx, projectID)
	if err != nil {
		return false
	}

	for _, task := range tasks {
		if task.Status != TaskStatusReview {
			continue
		}

		output := ""
		if task.Output != nil {
			output = strings.TrimSpace(*task.Output)
		}

		// Very weak outputs or explicit "no workspace files" reports are sent back for revision.
		needsRevision := output == "" ||
			len(output) < 120 ||
			strings.Contains(strings.ToLower(output), "no files in workspace")

		if needsRevision {
			if err := c.svc.db.ClearTaskOutput(ctx, task.ID); err != nil {
				return false
			}
			_ = c.svc.TransitionTaskStatus(ctx, task.ID, TaskStatusInProgress, "forced_review_decision: insufficient output", "ceo:auto")
			_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &task.ID,
				"[Auto-review fallback] Deliverable quality is insufficient. Please revise with concrete output, file paths, and a concise summary.")
			if task.AssigneeID != nil {
				runState.WakeWorker(*task.AssigneeID)
			}
			return true
		}

		if err := c.svc.TransitionTaskStatus(ctx, task.ID, TaskStatusDone, "forced_review_decision: approve fallback", "ceo:auto"); err != nil {
			return false
		}
		_ = sendSystemMsg(ctx, c.svc.db, c.svc.bus, projectID, &task.ID,
			"[Auto-review fallback] Task approved after repeated no-action CEO cycles.")
		return true
	}

	return false
}
