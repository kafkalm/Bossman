package engine

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/kafkalm/bossman/agent-engine/internal/agent"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/workspace"
)

// ProjectRunState is the abstraction passed to RunCeoCycle for inter-employee signaling.
type ProjectRunState interface {
	ProjectID() string
	WakeWorker(employeeID string)
	TriggerCEO()
}

// Service is a thin registry of employee instances and handles API-layer project management.
type Service struct {
	// infrastructure
	db        *db.DB
	bus       *bus.Bus
	runtime   *agent.Runtime
	workspace *workspace.Workspace

	mu      sync.RWMutex
	workers map[string]*Worker // employeeID → Worker
	ceos    map[string]*CEO    // companyID  → CEO

	founderMessages sync.Map // projectID → string
}

// NewService creates a new Service.
func NewService(database *db.DB, msgBus *bus.Bus, runtime *agent.Runtime, ws *workspace.Workspace) *Service {
	return &Service{
		db:        database,
		bus:       msgBus,
		runtime:   runtime,
		workspace: ws,
		workers:   make(map[string]*Worker),
		ceos:      make(map[string]*CEO),
	}
}

// Register adds a CEO or Worker to the service registry.
func (s *Service) Register(emp Employee) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e := emp.(type) {
	case *CEO:
		s.ceos[e.companyID] = e
		log.Printf("[Service] registered CEO %s (company %s)", e.name, e.companyID)
	case *Worker:
		s.workers[e.id] = e
		log.Printf("[Service] registered Worker %s (%s)", e.name, e.id)
	}
}

// WakeEmployee sends a wake signal to a worker employee by ID.
func (s *Service) WakeEmployee(employeeID string) {
	s.mu.RLock()
	w, ok := s.workers[employeeID]
	s.mu.RUnlock()
	if ok {
		w.Wake()
	}
}

// TriggerCEOForProject looks up the CEO for the project's company and sends a project trigger.
func (s *Service) TriggerCEOForProject(projectID string) {
	project, err := s.db.GetProject(context.Background(), projectID)
	if err != nil {
		return
	}
	s.mu.RLock()
	ceo, ok := s.ceos[project.CompanyID]
	s.mu.RUnlock()
	if ok {
		ceo.TriggerProject(projectID)
	}
}

func (s *Service) takeFounderMessage(projectID string) string {
	v, ok := s.founderMessages.LoadAndDelete(projectID)
	if !ok {
		return ""
	}
	return v.(string)
}

// StartProject sets project status to in_progress and triggers the CEO to pick it up.
func (s *Service) StartProject(projectID string) error {
	ctx := context.Background()
	project, err := s.db.GetProject(ctx, projectID)
	if err != nil {
		return fmt.Errorf("load project: %w", err)
	}
	if project.Status == "in_progress" {
		return nil
	}
	if err := s.db.UpdateProjectStatus(ctx, projectID, "in_progress"); err != nil {
		return fmt.Errorf("update status: %w", err)
	}
	s.TriggerCEOForProject(projectID)
	return nil
}

// StopProject sets project status to cancelled so employees skip it.
func (s *Service) StopProject(projectID string) {
	_ = s.db.UpdateProjectStatus(context.Background(), projectID, "cancelled")
}

// IsRunning returns true if the project is in_progress.
func (s *Service) IsRunning(projectID string) bool {
	project, err := s.db.GetProject(context.Background(), projectID)
	if err != nil {
		return false
	}
	return project.Status == "in_progress"
}

// SendFounderMessage stores the message and triggers the CEO for that project.
func (s *Service) SendFounderMessage(projectID, message string) error {
	project, err := s.db.GetProject(context.Background(), projectID)
	if err != nil {
		return fmt.Errorf("project not found: %w", err)
	}
	if project.Status != "in_progress" {
		return fmt.Errorf("project %s is not in progress", projectID)
	}
	s.founderMessages.Store(projectID, message)
	s.TriggerCEOForProject(projectID)
	return nil
}
