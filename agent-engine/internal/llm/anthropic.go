package llm

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
)

// AnthropicProvider implements Provider using the official Anthropic Go SDK v1.x
type AnthropicProvider struct {
	client *anthropic.Client
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	client := anthropic.NewClient(option.WithAPIKey(apiKey))
	return &AnthropicProvider{client: &client}
}

func (p *AnthropicProvider) Call(cfg ModelConfig, messages []ChatMessage, system string, tools []ToolDefinition, opts CallOptions) (*LLMResponse, error) {
	ctx := context.Background()

	// Convert messages to Anthropic MessageParam
	var anthropicMsgs []anthropic.MessageParam
	for _, m := range messages {
		switch m.Role {
		case "user":
			anthropicMsgs = append(anthropicMsgs, anthropic.NewUserMessage(anthropic.NewTextBlock(m.Content)))
		case "assistant":
			anthropicMsgs = append(anthropicMsgs, anthropic.NewAssistantMessage(anthropic.NewTextBlock(m.Content)))
		}
	}

	// Build request params
	params := anthropic.MessageNewParams{
		Model:    anthropic.Model(cfg.Model),
		Messages: anthropicMsgs,
		MaxTokens: 8096,
	}

	if cfg.MaxTokens != nil {
		params.MaxTokens = int64(*cfg.MaxTokens)
	}

	if system != "" {
		params.System = []anthropic.TextBlockParam{
			{Text: system},
		}
	}

	if cfg.Temperature != nil {
		params.Temperature = param.Opt[float64]{Value: *cfg.Temperature}
	}

	// Convert tools
	if len(tools) > 0 {
		var anthropicTools []anthropic.ToolUnionParam
		for _, t := range tools {
			props := map[string]interface{}{}
			for k, v := range t.Parameters {
				props[k] = v
			}
			tp := anthropic.ToolParam{
				Name:        t.Name,
				Description: param.Opt[string]{Value: t.Description},
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: props,
					Required:   t.Required,
				},
			}
			anthropicTools = append(anthropicTools, anthropic.ToolUnionParam{OfTool: &tp})
		}
		params.Tools = anthropicTools
		if opts.RequireToolCall {
			params.ToolChoice = anthropic.ToolChoiceUnionParam{
				OfAny: &anthropic.ToolChoiceAnyParam{
					DisableParallelToolUse: param.Opt[bool]{Value: true},
				},
			}
		}
	}

	resp, err := p.client.Messages.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("anthropic call: %w", err)
	}

	result := &LLMResponse{}

	for _, block := range resp.Content {
		switch block.Type {
		case "text":
			result.Content += block.AsText().Text
		case "tool_use":
			tb := block.AsToolUse()
			var args map[string]interface{}
			if tb.Input != nil {
				if err := json.Unmarshal(tb.Input, &args); err != nil {
					args = map[string]interface{}{}
				}
			}
			result.ToolCalls = append(result.ToolCalls, ToolCall{
				ID:   tb.ID,
				Name: tb.Name,
				Args: args,
			})
		}
	}

	inputTokens := int(resp.Usage.InputTokens)
	outputTokens := int(resp.Usage.OutputTokens)
	result.Usage = TokenUsageInfo{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		Model:        cfg.Model,
		Provider:     "anthropic",
		Cost:         EstimateCost(cfg.Model, inputTokens, outputTokens),
	}

	return result, nil
}
