package engine

import "context"

// Employee is the interface for a running agent goroutine.
type Employee interface {
	Loop(ctx context.Context) error
}

// projectRunState implements ProjectRunState for one CEO cycle execution.
type projectRunState struct {
	svc       *Service
	ceo       *CEO
	projectID string
}

func (r *projectRunState) ProjectID() string            { return r.projectID }
func (r *projectRunState) WakeWorker(employeeID string) { r.svc.WakeEmployee(employeeID) }
func (r *projectRunState) TriggerCEO()                  { r.ceo.TriggerProject(r.projectID) }
