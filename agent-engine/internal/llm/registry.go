package llm

import (
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/config"
)

// Registry selects the correct LLM provider based on ModelConfig.Provider
type Registry struct {
	anthropic  *AnthropicProvider
	openai     *OpenAIProvider
	google     *GoogleProvider
	openrouter *OpenAIProvider
	deepseek   *OpenAIProvider
}

// NewRegistry initializes all available providers from config
func NewRegistry(cfg *config.Config) *Registry {
	r := &Registry{}
	if cfg.AnthropicAPIKey != "" {
		r.anthropic = NewAnthropicProvider(cfg.AnthropicAPIKey)
	}
	if cfg.OpenAIAPIKey != "" {
		r.openai = NewOpenAIProvider(cfg.OpenAIAPIKey)
	}
	if cfg.GoogleAPIKey != "" {
		r.google = NewGoogleProvider(cfg.GoogleAPIKey)
	}
	if cfg.OpenRouterAPIKey != "" {
		r.openrouter = NewOpenRouterProvider(cfg.OpenRouterAPIKey)
	}
	if cfg.DeepSeekAPIKey != "" {
		r.deepseek = NewDeepSeekProvider(cfg.DeepSeekAPIKey)
	}
	return r
}

// Call dispatches an LLM call to the correct provider
func (r *Registry) Call(cfg ModelConfig, messages []ChatMessage, system string, tools []ToolDefinition) (*LLMResponse, error) {
	switch cfg.Provider {
	case "anthropic":
		if r.anthropic == nil {
			return nil, fmt.Errorf("ANTHROPIC_API_KEY not configured")
		}
		return r.anthropic.Call(cfg, messages, system, tools)
	case "openai":
		if r.openai == nil {
			return nil, fmt.Errorf("OPENAI_API_KEY not configured")
		}
		return r.openai.Call(cfg, messages, system, tools)
	case "google":
		if r.google == nil {
			return nil, fmt.Errorf("GOOGLE_GENERATIVE_AI_API_KEY not configured")
		}
		return r.google.Call(cfg, messages, system, tools)
	case "openrouter":
		if r.openrouter == nil {
			return nil, fmt.Errorf("OPENROUTER_API_KEY not configured")
		}
		return r.openrouter.Call(cfg, messages, system, tools)
	case "deepseek":
		if r.deepseek == nil {
			return nil, fmt.Errorf("DEEPSEEK_API_KEY not configured")
		}
		return r.deepseek.Call(cfg, messages, system, tools)
	default:
		return nil, fmt.Errorf("unsupported LLM provider: %s", cfg.Provider)
	}
}
