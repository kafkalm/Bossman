package engine

import "github.com/kafkalm/bossman/agent-engine/internal/db"

const maxCommandOutputBytes = 8 * 1024 // 8KB
const maxEmptyRounds = 3               // consecutive no-deliverable rounds before blocking a task

// Worker is the rich model for a worker agent. It owns its loop and wakes on task assignments.
type Worker struct {
	id          string
	name        string
	svc         *Service
	wake        chan struct{}
	emptyRounds map[string]int // taskID -> consecutive no-deliverable count
}

// NewWorker creates a new Worker employee.
func NewWorker(emp db.EmployeeWithRole, svc *Service) *Worker {
	return &Worker{
		id:          emp.ID,
		name:        emp.Name,
		svc:         svc,
		wake:        make(chan struct{}, 1),
		emptyRounds: make(map[string]int),
	}
}

// Wake sends a non-blocking wake signal to this worker.
func (w *Worker) Wake() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}
