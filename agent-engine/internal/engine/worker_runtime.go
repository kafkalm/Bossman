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
			return
		}
		if task == nil {
			return
		}
		w.executeTask(ctx, task, projectID)
	}
}

func (w *Worker) executeTask(ctx context.Context, task *db.Task, projectID string) {
	taskID := task.ID
	taskTitle := task.Title

	err := retryWithBackoff(ctx, func() error {
		return w.executeForEmployee(ctx, taskID)
	}, func(attempt int, retryErr error) {
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
			fmt.Sprintf("Task \"%s\" failed (attempt %d/3), retrying...", taskTitle, attempt))
	})

	if err != nil {
		validateTaskTransitionOrWarn(TaskStatusInProgress, TaskStatusBlocked, taskID)
		_ = w.svc.db.UpdateTaskStatus(ctx, taskID, TaskStatusBlocked)
		_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
			fmt.Sprintf("Task \"%s\" execution failed after 3 attempts: %v", taskTitle, err))
		w.svc.TriggerCEOForProject(projectID)
		return
	}

	updated, err := w.svc.db.GetTask(ctx, taskID)
	if err == nil && updated.Status == TaskStatusAssigned {
		w.emptyRounds[taskID]++
		if w.emptyRounds[taskID] >= maxEmptyRounds {
			validateTaskTransitionOrWarn(TaskStatusAssigned, TaskStatusBlocked, taskID)
			_ = w.svc.db.UpdateTaskStatus(ctx, taskID, TaskStatusBlocked)
			_ = sendSystemMsg(ctx, w.svc.db, w.svc.bus, projectID, &taskID,
				fmt.Sprintf("Task \"%s\" blocked: no deliverable produced after %d attempts.", taskTitle, maxEmptyRounds))
			delete(w.emptyRounds, taskID)
		}
	} else {
		delete(w.emptyRounds, taskID)
	}

	w.svc.TriggerCEOForProject(projectID)
}
