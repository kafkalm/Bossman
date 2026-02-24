package engine

import (
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
	"github.com/kafkalm/bossman/agent-engine/internal/workspace"
)

// LLMCaller is the minimal LLM dependency used by the engine.
type LLMCaller interface {
	Call(cfg llm.ModelConfig, messages []llm.ChatMessage, system string, tools []llm.ToolDefinition, opts llm.CallOptions) (*llm.LLMResponse, error)
}

// WorkspaceStore is the minimal workspace dependency used by workers.
type WorkspaceStore interface {
	ProjectRoot(projectID string) (string, error)
	WriteFile(projectID, employeeID string, pathDir *string, title, content string) (string, error)
	ReadFile(projectID, relativePath string) (string, error)
	ListFiles(projectID string) ([]workspace.FileEntry, error)
}

// BusPublisher is the minimal bus dependency used by the engine.
type BusPublisher interface {
	Publish(msg bus.BusMessage)
}
