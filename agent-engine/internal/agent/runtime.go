package agent

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

// RunOptions is the input to AgentRuntime.Run
type RunOptions struct {
	EmployeeID         string
	ProjectID          string
	TaskID             *string
	Tools              []llm.ToolDefinition
	AdditionalMessages []llm.ChatMessage
}

// RunResult is the output of AgentRuntime.Run
type RunResult struct {
	Content   string
	ToolCalls []llm.ToolCall
	Usage     llm.TokenUsageInfo
}

// Runtime executes an agent for a given task or inquiry
type Runtime struct {
	db  *db.DB
	llm *llm.Registry
}

// New creates a new agent Runtime
func New(database *db.DB, registry *llm.Registry) *Runtime {
	return &Runtime{db: database, llm: registry}
}

// Run executes an agent: loads context, calls LLM, records token usage
func (r *Runtime) Run(ctx context.Context, opts RunOptions) (*RunResult, error) {
	// Load employee + role
	emp, err := r.db.GetEmployee(ctx, opts.EmployeeID)
	if err != nil {
		return nil, fmt.Errorf("load employee: %w", err)
	}

	// Load project
	project, err := r.db.GetProject(ctx, opts.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}

	// Load task (optional)
	var task *db.Task
	if opts.TaskID != nil {
		t, err := r.db.GetTask(ctx, *opts.TaskID)
		if err != nil {
			return nil, fmt.Errorf("load task: %w", err)
		}
		task = &t.Task
	}

	// Parse model config
	var modelCfg llm.ModelConfig
	if err := json.Unmarshal([]byte(emp.RoleModelConfig), &modelCfg); err != nil {
		return nil, fmt.Errorf("parse model config: %w", err)
	}

	// Build context messages
	messages, err := BuildAgentContext(ctx, r.db, emp, project, task)
	if err != nil {
		return nil, fmt.Errorf("build context: %w", err)
	}

	// Append additional messages (e.g. CEO prompt, founder message)
	messages = append(messages, opts.AdditionalMessages...)

	// Mark employee busy
	_ = r.db.SetEmployeeStatus(ctx, opts.EmployeeID, "busy")
	defer func() {
		_ = r.db.SetEmployeeStatus(ctx, opts.EmployeeID, "idle")
	}()

	// Call LLM
	resp, err := r.llm.Call(modelCfg, messages, emp.RoleSystemPrompt, opts.Tools)
	if err != nil {
		return nil, fmt.Errorf("llm call: %w", err)
	}

	// Record token usage
	pid := opts.ProjectID
	_ = r.db.RecordTokenUsage(ctx, opts.EmployeeID, &pid,
		resp.Usage.Model, resp.Usage.Provider,
		resp.Usage.InputTokens, resp.Usage.OutputTokens, resp.Usage.Cost)

	// Persist response as message if no taskID (project-level call)
	if resp.Content != "" && opts.TaskID == nil {
		_, _ = r.db.CreateMessage(ctx, opts.ProjectID, nil, &opts.EmployeeID, "agent", resp.Content, nil)
	}

	return &RunResult{
		Content:   resp.Content,
		ToolCalls: resp.ToolCalls,
		Usage:     resp.Usage,
	}, nil
}
