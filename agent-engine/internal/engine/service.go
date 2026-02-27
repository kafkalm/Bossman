package engine

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
	"github.com/kafkalm/bossman/agent-engine/internal/workspace"
)

// ProjectRunState is the abstraction passed to RunCeoCycle for inter-employee signaling.
type ProjectRunState interface {
	ProjectID() string
	WakeWorker(employeeID string)
	TriggerCEO()
}

// Service keeps employee registry and shared runtime dependencies.
type Service struct {
	db        *db.DB
	bus       BusPublisher
	llm       LLMCaller
	workspace WorkspaceStore

	mu      sync.RWMutex
	workers map[string]*Worker // employeeID -> Worker
	ceos    map[string]*CEO    // companyID -> CEO

	founderMessages sync.Map // projectID -> string
}

type TimelinePage struct {
	Events     []db.TimelineEvent
	NextCursor *string
}

// NewService creates a new Service.
func NewService(database *db.DB, msgBus *bus.Bus, registry *llm.Registry, ws *workspace.Workspace) *Service {
	return &Service{
		db:        database,
		bus:       msgBus,
		llm:       registry,
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

// StartProject sets project status to active and triggers the CEO to pick it up.
func (s *Service) StartProject(projectID string) error {
	ctx := context.Background()
	project, err := s.db.GetProject(ctx, projectID)
	if err != nil {
		return fmt.Errorf("load project: %w", err)
	}
	project.Status = normalizeProjectStatus(project.Status)
	if project.Status == ProjectStatusActive {
		s.TriggerCEOForProject(projectID)
		return nil
	}
	if err := s.TransitionProjectStatus(ctx, projectID, ProjectStatusActive, "project started", "system"); err != nil {
		return fmt.Errorf("start project transition: %w", err)
	}
	s.TriggerCEOForProject(projectID)
	return nil
}

// StopProject sets project status to canceled so employees skip it.
func (s *Service) StopProject(projectID string) {
	ctx := context.Background()
	if err := s.TransitionProjectStatus(ctx, projectID, ProjectStatusCanceled, "project stopped", "system"); err != nil {
		log.Printf("[Service] StopProject transition failed: %v", err)
	}
}

// PauseProject sets project status to paused so CEO/Workers stop executing project tasks.
func (s *Service) PauseProject(projectID string) error {
	ctx := context.Background()
	project, err := s.db.GetProject(ctx, projectID)
	if err != nil {
		return fmt.Errorf("load project: %w", err)
	}
	status := normalizeProjectStatus(project.Status)
	if status == ProjectStatusPaused {
		return nil
	}
	if err := s.TransitionProjectStatus(ctx, projectID, ProjectStatusPaused, "project paused", "system"); err != nil {
		return fmt.Errorf("pause project transition: %w", err)
	}
	return nil
}

// IsRunning returns true if the project is active.
func (s *Service) IsRunning(projectID string) bool {
	project, err := s.db.GetProject(context.Background(), projectID)
	if err != nil {
		return false
	}
	return normalizeProjectStatus(project.Status) == ProjectStatusActive
}

// SendFounderMessage stores the message and triggers the CEO for that project.
func (s *Service) SendFounderMessage(projectID, message string) error {
	project, err := s.db.GetProject(context.Background(), projectID)
	if err != nil {
		return fmt.Errorf("project not found: %w", err)
	}
	status := normalizeProjectStatus(project.Status)
	if status != ProjectStatusActive && status != ProjectStatusReview {
		return fmt.Errorf("project %s is not active", projectID)
	}
	s.founderMessages.Store(projectID, message)
	s.TriggerCEOForProject(projectID)
	return nil
}

// GetTimeline returns recent timeline events for a project.
func (s *Service) GetTimeline(projectID string, taskID *string, limit int) ([]db.TimelineEvent, error) {
	return s.db.GetTimelineEvents(context.Background(), projectID, taskID, limit)
}

// GetTimelinePage returns paged timeline events for a project.
func (s *Service) GetTimelinePage(projectID string, taskID *string, limit int, cursor string, direction string) (*TimelinePage, error) {
	var cursorID string
	var cursorCreatedAt time.Time
	var hasCursor bool
	if direction != "newer" {
		direction = "older"
	}
	if cursor != "" {
		parsedAt, parsedID, err := decodeTimelineCursor(cursor)
		if err != nil {
			return nil, fmt.Errorf("invalid cursor: %w", err)
		}
		cursorID = parsedID
		cursorCreatedAt = parsedAt
		hasCursor = true
	}

	events, err := s.db.GetTimelineEventsWithCursor(context.Background(), projectID, taskID, limit, cursorID, cursorCreatedAt, hasCursor, direction)
	if err != nil {
		return nil, err
	}

	var nextCursor *string
	if len(events) == limit {
		last := events[len(events)-1]
		c := encodeTimelineCursor(last.CreatedAt, last.ID)
		nextCursor = &c
	}
	return &TimelinePage{Events: events, NextCursor: nextCursor}, nil
}

func encodeTimelineCursor(createdAt time.Time, id string) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeTimelineCursor(cursor string) (time.Time, string, error) {
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	raw := string(b)
	parts := strings.SplitN(raw, "|", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return time.Time{}, "", fmt.Errorf("invalid cursor payload")
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return createdAt, parts[1], nil
}

// CommandProject executes a high-level project command.
func (s *Service) CommandProject(projectID, action string, payload map[string]interface{}) error {
	switch action {
	case "start":
		return s.StartProject(projectID)
	case "pause":
		return s.PauseProject(projectID)
	case "stop":
		s.StopProject(projectID)
		return nil
	case "send_founder_message":
		content, _ := payload["content"].(string)
		if content == "" {
			return fmt.Errorf("content is required")
		}
		return s.SendFounderMessage(projectID, content)
	default:
		return fmt.Errorf("unsupported action: %s", action)
	}
}

// TransitionProjectStatus validates and applies a project status transition.
func (s *Service) TransitionProjectStatus(ctx context.Context, projectID, to, reason, actor string) error {
	project, err := s.db.GetProject(ctx, projectID)
	if err != nil {
		return fmt.Errorf("load project: %w", err)
	}
	from := normalizeProjectStatus(project.Status)
	to = normalizeProjectStatus(to)
	if err := ValidateProjectTransition(from, to, projectID); err != nil {
		return err
	}
	_, err = s.db.TransitionProjectStatus(ctx, projectID, to, reason, actor)
	if err != nil {
		return fmt.Errorf("transition project status: %w", err)
	}
	_ = s.db.AddTimelineEvent(ctx, projectID, nil, "project.transition", actor,
		fmt.Sprintf("project status %s -> %s", from, to),
		map[string]interface{}{"from": from, "to": to, "reason": reason})
	s.bus.Publish(bus.BusMessage{
		ID:          fmt.Sprintf("project-transition:%s:%d", projectID, time.Now().UnixNano()),
		ProjectID:   projectID,
		SenderType:  "system",
		MessageType: EngineEventProjectUpdated,
		Content:     fmt.Sprintf("project status %s -> %s", from, to),
		Metadata:    map[string]interface{}{"from": from, "to": to, "reason": reason},
		CreatedAt:   time.Now(),
	})
	return nil
}

// TransitionTaskStatus validates and applies a task status transition.
func (s *Service) TransitionTaskStatus(ctx context.Context, taskID, to, reason, actor string) error {
	task, err := s.db.GetTask(ctx, taskID)
	if err != nil {
		return fmt.Errorf("load task: %w", err)
	}
	from := normalizeTaskStatus(task.Status)
	to = normalizeTaskStatus(to)
	if err := ValidateTaskTransition(from, to, taskID); err != nil {
		return err
	}
	_, projectID, err := s.db.TransitionTaskStatus(ctx, taskID, to, reason, actor)
	if err != nil {
		return fmt.Errorf("transition task status: %w", err)
	}
	_ = s.db.AddTimelineEvent(ctx, projectID, &taskID, "task.transition", actor,
		fmt.Sprintf("task status %s -> %s", from, to),
		map[string]interface{}{"from": from, "to": to, "reason": reason})
	s.bus.Publish(bus.BusMessage{
		ID:          fmt.Sprintf("task-transition:%s:%d", taskID, time.Now().UnixNano()),
		ProjectID:   projectID,
		TaskID:      &taskID,
		SenderType:  "system",
		MessageType: EngineEventTaskTransitioned,
		Content:     fmt.Sprintf("task status %s -> %s", from, to),
		Metadata:    map[string]interface{}{"from": from, "to": to, "reason": reason},
		CreatedAt:   time.Now(),
	})
	return nil
}
