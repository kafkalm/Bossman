package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
	"github.com/kafkalm/bossman/agent-engine/internal/workspace"
)

const maxContextMessages = 50
const projectContextMessages = 20

// RunOptions is the input to Service.Run.
// Callers may supply pre-loaded Employee, Project, or Task to skip redundant
// DB round-trips; the corresponding ID fields are only used when the
// pre-loaded object is nil.
type RunOptions struct {
	Employee            *db.EmployeeWithRole
	Project             *db.Project
	Task                *db.Task
	EmployeeID          string
	ProjectID           string
	TaskID              *string
	Tools               []llm.ToolDefinition
	AdditionalMessages  []llm.ChatMessage
}

// RunResult is the output of Service.Run.
type RunResult struct {
	Content   string
	ToolCalls []llm.ToolCall
	Usage     llm.TokenUsageInfo
}

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
	llm       *llm.Registry
	workspace *workspace.Workspace

	mu      sync.RWMutex
	workers map[string]*Worker // employeeID → Worker
	ceos    map[string]*CEO    // companyID  → CEO

	founderMessages sync.Map // projectID → string
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

// Run executes an agent: resolves any missing context, calls LLM, records token usage.
func (s *Service) Run(ctx context.Context, opts RunOptions) (*RunResult, error) {
	emp := opts.Employee
	if emp == nil {
		loaded, err := s.db.GetEmployee(ctx, opts.EmployeeID)
		if err != nil {
			return nil, fmt.Errorf("load employee: %w", err)
		}
		emp = loaded
	}

	project := opts.Project
	if project == nil {
		loaded, err := s.db.GetProject(ctx, opts.ProjectID)
		if err != nil {
			return nil, fmt.Errorf("load project: %w", err)
		}
		project = loaded
	}

	task := opts.Task
	if task == nil && opts.TaskID != nil {
		loaded, err := s.db.GetTask(ctx, *opts.TaskID)
		if err != nil {
			return nil, fmt.Errorf("load task: %w", err)
		}
		task = &loaded.Task
	}

	var modelCfg llm.ModelConfig
	if err := json.Unmarshal([]byte(emp.RoleModelConfig), &modelCfg); err != nil {
		return nil, fmt.Errorf("parse model config: %w", err)
	}

	messages, err := s.BuildAgentContext(ctx, emp, project, task)
	if err != nil {
		return nil, fmt.Errorf("build context: %w", err)
	}

	messages = append(messages, opts.AdditionalMessages...)

	_ = s.db.SetEmployeeStatus(ctx, emp.ID, "busy")
	defer func() {
		_ = s.db.SetEmployeeStatus(ctx, emp.ID, "idle")
	}()

	resp, err := s.llm.Call(modelCfg, messages, emp.RoleSystemPrompt, opts.Tools)
	if err != nil {
		return nil, fmt.Errorf("llm call: %w", err)
	}

	projectID := project.ID
	_ = s.db.RecordTokenUsage(ctx, emp.ID, &projectID,
		resp.Usage.Model, resp.Usage.Provider,
		resp.Usage.InputTokens, resp.Usage.OutputTokens, resp.Usage.Cost)

	if resp.Content != "" && task == nil {
		_, _ = s.db.CreateMessage(ctx, project.ID, nil, &emp.ID, "agent", resp.Content, nil)
	}

	return &RunResult{
		Content:   resp.Content,
		ToolCalls: resp.ToolCalls,
		Usage:     resp.Usage,
	}, nil
}

// BuildAgentContext assembles the message history for an agent LLM call.
func (s *Service) BuildAgentContext(ctx context.Context, emp *db.EmployeeWithRole, project *db.Project, task *db.Task) ([]llm.ChatMessage, error) {
	var messages []llm.ChatMessage

	messages = append(messages, llm.ChatMessage{
		Role:    "user",
		Content: formatProjectContext(emp, project, task),
	})

	if task != nil {
		projectMsgs, err := s.db.GetProjectMessages(ctx, project.ID, projectContextMessages)
		if err != nil {
			return nil, fmt.Errorf("project messages: %w", err)
		}
		taskMsgs, err := s.db.GetTaskMessages(ctx, task.ID)
		if err != nil {
			return nil, fmt.Errorf("task messages: %w", err)
		}

		merged := mergeAndDedup(projectMsgs, taskMsgs)
		for _, msg := range merged {
			messages = append(messages, convertDBMessage(msg, emp.ID))
		}
	} else {
		projectMsgs, err := s.db.GetProjectMessages(ctx, project.ID, maxContextMessages)
		if err != nil {
			return nil, fmt.Errorf("project messages: %w", err)
		}
		for _, msg := range projectMsgs {
			messages = append(messages, convertDBMessage(msg, emp.ID))
		}
	}

	return trimContext(messages), nil
}

func formatProjectContext(emp *db.EmployeeWithRole, project *db.Project, task *db.Task) string {
	s := fmt.Sprintf("You are %s, serving as %s in this project.\n\n", emp.Name, emp.RoleTitle)
	s += fmt.Sprintf("## Project: %s\n%s\n\n", project.Name, project.Description)

	if task != nil {
		s += fmt.Sprintf("## Your Current Task: %s\n%s\n\n", task.Title, task.Description)
	}

	s += "## Your Workspace\n"
	s += "You have a personal workspace (your folder in the project's Document/Code tab). Save your work there as you go:\n"
	s += "- Use **save_to_workspace** to save drafts, outlines, research notes, and intermediate code.\n"
	s += "- Use **create_file** for final deliverables to submit to the CEO.\n"
	s += "- Use **execute_command** to run shell commands (build, test, install packages, etc.) in the project workspace.\n\n"
	s += "Please complete your assigned work. Be thorough and professional."

	return s
}

func convertDBMessage(msg db.Message, selfEmployeeID string) llm.ChatMessage {
	if msg.SenderType == "agent" && msg.SenderID != nil && *msg.SenderID == selfEmployeeID {
		return llm.ChatMessage{Role: "assistant", Content: msg.Content}
	}
	label := senderLabel(msg)
	return llm.ChatMessage{
		Role:    "user",
		Content: fmt.Sprintf("[%s]: %s", label, msg.Content),
	}
}

func senderLabel(msg db.Message) string {
	switch msg.SenderType {
	case "founder":
		return "Founder"
	case "system":
		return "System"
	default:
		return "Agent"
	}
}

func mergeAndDedup(a, b []db.Message) []db.Message {
	seen := make(map[string]bool, len(a)+len(b))
	var result []db.Message
	for _, m := range a {
		if !seen[m.ID] {
			seen[m.ID] = true
			result = append(result, m)
		}
	}
	for _, m := range b {
		if !seen[m.ID] {
			seen[m.ID] = true
			result = append(result, m)
		}
	}
	for i := 1; i < len(result); i++ {
		for j := i; j > 0 && result[j].CreatedAt.Before(result[j-1].CreatedAt); j-- {
			result[j], result[j-1] = result[j-1], result[j]
		}
	}
	return result
}

func trimContext(messages []llm.ChatMessage) []llm.ChatMessage {
	if len(messages) <= maxContextMessages {
		return messages
	}
	first := messages[0]
	recent := messages[len(messages)-(maxContextMessages-1):]
	return append([]llm.ChatMessage{first}, recent...)
}
