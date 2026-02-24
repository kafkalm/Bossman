package engine

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

// RunOptions is the input to Service.Run.
// Callers may supply pre-loaded Employee, Project, or Task to skip redundant
// DB round-trips; the corresponding ID fields are only used when the
// pre-loaded object is nil.
type RunOptions struct {
	Employee           *db.EmployeeWithRole
	Project            *db.Project
	Task               *db.Task
	EmployeeID         string
	ProjectID          string
	TaskID             *string
	Tools              []llm.ToolDefinition
	AdditionalMessages []llm.ChatMessage
}

// RunResult is the output of Service.Run.
type RunResult struct {
	Content   string
	ToolCalls []llm.ToolCall
	Usage     llm.TokenUsageInfo
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

	return &RunResult{Content: resp.Content, ToolCalls: resp.ToolCalls, Usage: resp.Usage}, nil
}
