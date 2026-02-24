package engine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

// workerLoop waits for wake signals or polls for assigned tasks on a ticker.
func (w *Worker) Loop(ctx context.Context) error {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-w.wake:
			w.executeAllTasks(ctx)
		case <-ticker.C:
			w.executeAllTasks(ctx)
		}
	}
}

// executeAllTasks pulls all runnable tasks for this worker and executes them one-by-one.
func (w *Worker) executeAllTasks(ctx context.Context) {
	for {
		task, projectID, err := w.svc.db.GetNextTodoTask(ctx, w.id)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				log.Printf("[Worker %s] GetNextTodoTask error: %v", w.name, err)
			}
			_ = w.svc.db.SetEmployeeStatus(ctx, w.id, "idle")
			return
		}
		if task == nil {
			_ = w.svc.db.SetEmployeeStatus(ctx, w.id, "idle")
			return
		}
		w.executeTask(ctx, task, projectID)
	}
}

func (w *Worker) executeTask(ctx context.Context, task *db.Task, projectID string) {
	taskID := task.ID
	taskTitle := task.Title
	emptyRound := false
	enteredReview := false
	project, err := w.svc.db.GetProject(ctx, projectID)
	if err != nil {
		log.Printf("[Worker %s] load project %s error: %v", w.name, projectID, err)
		return
	}
	if normalizeProjectStatus(project.Status) != ProjectStatusActive {
		return
	}

	err = retryWithBackoff(ctx, func() error {
		cycleResult, runErr := w.executeForEmployee(ctx, taskID)
		if runErr == nil {
			emptyRound = cycleResult.EmptyRound
			enteredReview = cycleResult.EnteredReview
		}
		return runErr
	}, func(attempt int, retryErr error) {
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
			fmt.Sprintf("Task \"%s\" failed (attempt %d/3), retrying...", taskTitle, attempt))
	})

	if err != nil {
		_ = w.svc.TransitionTaskStatus(ctx, taskID, TaskStatusBlocked, "worker retries exhausted", w.id)
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
			fmt.Sprintf("Task \"%s\" execution failed after 3 attempts: %v", taskTitle, err))
		w.svc.TriggerCEOForProject(projectID)
		return
	}

	if emptyRound {
		w.emptyRounds[taskID]++
		if w.emptyRounds[taskID] >= maxEmptyRounds {
			_ = w.svc.TransitionTaskStatus(ctx, taskID, TaskStatusBlocked, "empty output threshold reached", w.id)
			_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
				fmt.Sprintf("Task \"%s\" blocked: no deliverable produced after %d attempts.", taskTitle, maxEmptyRounds))
			delete(w.emptyRounds, taskID)
			w.svc.TriggerCEOForProject(projectID)
			return
		}
	} else {
		delete(w.emptyRounds, taskID)
	}

	if enteredReview {
		w.svc.TriggerCEOForProject(projectID)
	}
}
