package llm

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
)

// OpenAIProvider implements Provider for OpenAI, OpenRouter, and DeepSeek
type OpenAIProvider struct {
	client   openai.Client
	provider string
}

func NewOpenAIProvider(apiKey string) *OpenAIProvider {
	client := openai.NewClient(option.WithAPIKey(apiKey))
	return &OpenAIProvider{client: client, provider: "openai"}
}

func NewOpenRouterProvider(apiKey string) *OpenAIProvider {
	client := openai.NewClient(
		option.WithAPIKey(apiKey),
		option.WithBaseURL("https://openrouter.ai/api/v1"),
	)
	return &OpenAIProvider{client: client, provider: "openrouter"}
}

func NewDeepSeekProvider(apiKey string) *OpenAIProvider {
	client := openai.NewClient(
		option.WithAPIKey(apiKey),
		option.WithBaseURL("https://api.deepseek.com"),
	)
	return &OpenAIProvider{client: client, provider: "deepseek"}
}

func (p *OpenAIProvider) Call(cfg ModelConfig, messages []ChatMessage, system string, tools []ToolDefinition, opts CallOptions) (*LLMResponse, error) {
	ctx := context.Background()

	var oaiMessages []openai.ChatCompletionMessageParamUnion
	if system != "" {
		oaiMessages = append(oaiMessages, openai.SystemMessage(system))
	}
	for _, m := range messages {
		switch m.Role {
		case "user":
			oaiMessages = append(oaiMessages, openai.UserMessage(m.Content))
		case "assistant":
			oaiMessages = append(oaiMessages, openai.AssistantMessage(m.Content))
		case "system":
			oaiMessages = append(oaiMessages, openai.SystemMessage(m.Content))
		}
	}

	params := openai.ChatCompletionNewParams{
		Model:    openai.ChatModel(cfg.Model),
		Messages: oaiMessages,
	}

	if cfg.Temperature != nil {
		params.Temperature = openai.Float(*cfg.Temperature)
	}
	if cfg.MaxTokens != nil {
		params.MaxTokens = openai.Int(int64(*cfg.MaxTokens))
	}

	if len(tools) > 0 {
		var oaiTools []openai.ChatCompletionToolParam
		for _, t := range tools {
			schema := buildFunctionParameters(t)
			oaiTools = append(oaiTools, openai.ChatCompletionToolParam{
				Function: openai.FunctionDefinitionParam{
					Name:        t.Name,
					Description: openai.String(t.Description),
					Parameters:  openai.FunctionParameters(schema),
				},
			})
		}
		params.Tools = oaiTools
		if opts.RequireToolCall {
			params.ToolChoice = openai.ChatCompletionToolChoiceOptionUnionParam{
				OfAuto: param.Opt[string]{Value: string(openai.ChatCompletionToolChoiceOptionAutoRequired)},
			}
		}
	}

	resp, err := p.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("openai call: %w", err)
	}

	result := &LLMResponse{}
	if len(resp.Choices) > 0 {
		choice := resp.Choices[0]
		result.Content = choice.Message.Content

		for _, tc := range choice.Message.ToolCalls {
			var args map[string]interface{}
			if tc.Function.Arguments != "" {
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
					args = map[string]interface{}{}
				}
			}
			result.ToolCalls = append(result.ToolCalls, ToolCall{
				ID:   tc.ID,
				Name: tc.Function.Name,
				Args: args,
			})
		}
	}

	inputTokens := int(resp.Usage.PromptTokens)
	outputTokens := int(resp.Usage.CompletionTokens)
	result.Usage = TokenUsageInfo{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		Model:        cfg.Model,
		Provider:     p.provider,
		Cost:         EstimateCost(cfg.Model, inputTokens, outputTokens),
	}

	return result, nil
}

// buildFunctionParameters converts a ToolDefinition's parameters to a JSON Schema map
func buildFunctionParameters(t ToolDefinition) map[string]interface{} {
	schema := map[string]interface{}{
		"type": "object",
	}
	if len(t.Parameters) > 0 {
		props := map[string]interface{}{}
		for k, v := range t.Parameters {
			props[k] = toolParamToMap(v)
		}
		schema["properties"] = props
	}
	if len(t.Required) > 0 {
		schema["required"] = t.Required
	}
	return schema
}

func toolParamToMap(p *ToolParameter) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{"type": "string"}
	}
	m := map[string]interface{}{"type": p.Type}
	if p.Description != "" {
		m["description"] = p.Description
	}
	if len(p.Enum) > 0 {
		m["enum"] = p.Enum
	}
	if p.Default != nil {
		m["default"] = p.Default
	}
	if p.Minimum != nil {
		m["minimum"] = *p.Minimum
	}
	if p.Maximum != nil {
		m["maximum"] = *p.Maximum
	}
	return m
}
