package llm

// ModelConfig mirrors the JSON stored in AgentRole.modelConfig
type ModelConfig struct {
	Provider    string   `json:"provider"`
	Model       string   `json:"model"`
	Temperature *float64 `json:"temperature,omitempty"`
	MaxTokens   *int     `json:"maxTokens,omitempty"`
}

// ChatMessage is a single turn in a conversation
type ChatMessage struct {
	Role    string `json:"role"` // system, user, assistant
	Content string `json:"content"`
}

// ToolParameter is an individual JSON Schema property for a tool
type ToolParameter struct {
	Type        string                    `json:"type"`
	Description string                    `json:"description,omitempty"`
	Enum        []string                  `json:"enum,omitempty"`
	Default     interface{}               `json:"default,omitempty"`
	Minimum     *float64                  `json:"minimum,omitempty"`
	Maximum     *float64                  `json:"maximum,omitempty"`
	Properties  map[string]*ToolParameter `json:"properties,omitempty"`
	Required    []string                  `json:"required,omitempty"`
	Items       *ToolParameter            `json:"items,omitempty"`
}

// ToolDefinition describes a callable tool for the LLM
type ToolDefinition struct {
	Name        string                    `json:"name"`
	Description string                    `json:"description"`
	Parameters  map[string]*ToolParameter `json:"parameters"` // JSON Schema "properties"
	Required    []string                  `json:"required"`
}

// ToolCall represents a tool invocation returned by the LLM
type ToolCall struct {
	ID   string                 `json:"id"`
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args"`
}

// TokenUsageInfo holds token counts and cost after an LLM call
type TokenUsageInfo struct {
	InputTokens  int
	OutputTokens int
	Model        string
	Provider     string
	Cost         *float64
}

// CallOptions controls provider-specific invocation behaviors.
type CallOptions struct {
	// RequireToolCall asks the provider to force a tool call when tools are present.
	RequireToolCall bool
}

// LLMResponse is the normalized response from any provider
type LLMResponse struct {
	Content   string
	ToolCalls []ToolCall
	Usage     TokenUsageInfo
}

// Provider is the interface every LLM backend must implement
type Provider interface {
	Call(cfg ModelConfig, messages []ChatMessage, system string, tools []ToolDefinition, opts CallOptions) (*LLMResponse, error)
}
