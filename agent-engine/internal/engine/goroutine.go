package engine

import (
	"context"
	"fmt"
	"log"
	"sync"
)

const maxCeoIterations = 200

// CeoTrigger is the message sent to the CEO channel
type CeoTrigger struct {
	FounderMessage string // empty = normal run
}

// ProjectRun holds the per-project goroutine state
type ProjectRun struct {
	ProjectID    string
	CeoTriggerCh chan CeoTrigger
	WakeSignals  map[string]chan struct{} // employeeID → buffered(1) wake channel
	cancel       context.CancelFunc
	mu           sync.RWMutex
}

// Scheduler manages all active project runs
type Scheduler struct {
	deps    *Deps
	mu      sync.Mutex
	runs    map[string]*ProjectRun
}

// NewScheduler creates the goroutine scheduler
func NewScheduler(deps *Deps) *Scheduler {
	return &Scheduler{
		deps: deps,
		runs: make(map[string]*ProjectRun),
	}
}

// StartProject launches goroutines for a project. Idempotent — returns nil if already running.
func (s *Scheduler) StartProject(projectID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.runs[projectID]; exists {
		return nil // already running
	}

	// Load employees to set up wake signals
	ctx := context.Background()
	employees, err := s.deps.DB.GetProjectEmployees(ctx, projectID)
	if err != nil {
		return fmt.Errorf("load employees: %w", err)
	}

	runCtx, cancel := context.WithCancel(context.Background())

	run := &ProjectRun{
		ProjectID:    projectID,
		CeoTriggerCh: make(chan CeoTrigger, 100),
		WakeSignals:  make(map[string]chan struct{}),
		cancel:       cancel,
	}

	for _, emp := range employees {
		if emp.RoleName == "ceo" {
			continue
		}
		run.WakeSignals[emp.ID] = make(chan struct{}, 1)
	}

	s.runs[projectID] = run

	// Launch worker goroutines
	for _, emp := range employees {
		if emp.RoleName == "ceo" {
			continue
		}
		empID := emp.ID
		empName := emp.Name
		go func() {
			s.runWorkerLoop(runCtx, run, empID, empName)
		}()
	}

	// Launch CEO goroutine
	go func() {
		s.runCeoLoop(runCtx, run)
	}()

	// Wake workers that already have assigned/in_progress tasks (resume case).
	// This must happen after goroutines are launched so the channels exist.
	for _, emp := range employees {
		if emp.RoleName == "ceo" {
			continue
		}
		queue, err := s.deps.DB.GetTodoQueue(ctx, emp.ID, projectID)
		if err == nil && len(queue) > 0 {
			if wake, ok := run.WakeSignals[emp.ID]; ok {
				select {
				case wake <- struct{}{}:
				default:
				}
			}
		}
	}

	// Trigger CEO (will skip LLM if all tasks are already active, which is correct)
	run.CeoTriggerCh <- CeoTrigger{}

	return nil
}

// StopProject cancels the goroutines for a project
func (s *Scheduler) StopProject(projectID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	run, ok := s.runs[projectID]
	if !ok {
		return
	}
	run.cancel()
	delete(s.runs, projectID)
}

// IsRunning reports whether a project is currently running
func (s *Scheduler) IsRunning(projectID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.runs[projectID]
	return ok
}

// SendFounderMessage injects a founder message into the CEO trigger channel
func (s *Scheduler) SendFounderMessage(projectID, message string) error {
	s.mu.Lock()
	run, ok := s.runs[projectID]
	s.mu.Unlock()

	if !ok {
		return fmt.Errorf("project %s is not running", projectID)
	}

	select {
	case run.CeoTriggerCh <- CeoTrigger{FounderMessage: message}:
		return nil
	default:
		return fmt.Errorf("CEO trigger channel full")
	}
}

// runCeoLoop is the CEO's main goroutine: waits for triggers, runs CEO cycle, re-triggers as needed
func (s *Scheduler) runCeoLoop(ctx context.Context, run *ProjectRun) {
	iteration := 0

	for {
		select {
		case <-ctx.Done():
			return

		case trigger := <-run.CeoTriggerCh:
			// Check project status
			project, err := s.deps.DB.GetProject(ctx, run.ProjectID)
			if err != nil {
				log.Printf("[CEO %s] load project error: %v", run.ProjectID, err)
				continue
			}
			if project.Status == "completed" || project.Status == "failed" {
				s.StopProject(run.ProjectID)
				return
			}

			iter := iteration
			if iter > maxCeoIterations-1 {
				iter = maxCeoIterations - 1
			}

			result, err := RunCeoCycle(ctx, s.deps, run, iter, maxCeoIterations, trigger.FounderMessage)
			if err != nil {
				log.Printf("[CEO %s] cycle error (iter %d): %v", run.ProjectID, iteration, err)
				// Don't stop on transient errors
				continue
			}

			iteration++

			if result.ShouldStop {
				s.StopProject(run.ProjectID)
				return
			}

			// Re-check project status
			projectAfter, err := s.deps.DB.GetProject(ctx, run.ProjectID)
			if err == nil && (projectAfter.Status == "completed" || projectAfter.Status == "failed") {
				s.StopProject(run.ProjectID)
				return
			}

			// Smart self-trigger
			tasks, _ := s.deps.DB.GetTasksForProject(ctx, run.ProjectID)
			if shouldSelfTrigger(result, tasks) {
				select {
				case run.CeoTriggerCh <- CeoTrigger{}:
				default:
				}
			}
			// (If not self-triggered, CEO waits for a worker to complete and push a trigger)
		}
	}
}

// runWorkerLoop is a worker's main goroutine: waits for wake signals, executes one task
func (s *Scheduler) runWorkerLoop(ctx context.Context, run *ProjectRun, employeeID, employeeName string) {
	run.mu.RLock()
	wake, ok := run.WakeSignals[employeeID]
	run.mu.RUnlock()
	if !ok {
		return
	}

	for {
		select {
		case <-ctx.Done():
			return

		case <-wake:
			queue, err := s.deps.DB.GetTodoQueue(ctx, employeeID, run.ProjectID)
			if err != nil {
				log.Printf("[Worker %s/%s] todo queue error: %v", employeeName, run.ProjectID, err)
				continue
			}
			if len(queue) == 0 {
				continue
			}

			taskID := queue[0].ID
			taskTitle := queue[0].Title

			err = retryWithBackoff(ctx, func() error {
				return ExecuteTaskForEmployee(ctx, s.deps, taskID)
			}, func(attempt int, retryErr error) {
				_ = sendSystemMsg(ctx, s.deps, run.ProjectID, &taskID,
					fmt.Sprintf("Task \"%s\" failed (attempt %d/3), retrying...", taskTitle, attempt))
			})

			if err != nil {
				// All retries exhausted → block task
				_ = s.deps.DB.UpdateTaskStatus(ctx, taskID, "blocked")
				_ = sendSystemMsg(ctx, s.deps, run.ProjectID, &taskID,
					fmt.Sprintf("Task \"%s\" execution failed after 3 attempts: %v", taskTitle, err))
			}

			// Notify CEO regardless of success/failure
			select {
			case run.CeoTriggerCh <- CeoTrigger{}:
			default:
			}
		}
	}
}
