package llm

import (
	"context"
	"fmt"

	"google.golang.org/genai"
)

// GoogleProvider implements Provider using Google GenAI SDK v1.x
type GoogleProvider struct {
	apiKey string
}

func NewGoogleProvider(apiKey string) *GoogleProvider {
	return &GoogleProvider{apiKey: apiKey}
}

func (p *GoogleProvider) Call(cfg ModelConfig, messages []ChatMessage, system string, tools []ToolDefinition, opts CallOptions) (*LLMResponse, error) {
	ctx := context.Background()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  p.apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("google client: %w", err)
	}

	// Build content parts
	var contents []*genai.Content
	for _, m := range messages {
		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		contents = append(contents, &genai.Content{
			Role:  role,
			Parts: []*genai.Part{genai.NewPartFromText(m.Content)},
		})
	}

	config := &genai.GenerateContentConfig{}

	if system != "" {
		config.SystemInstruction = &genai.Content{
			Parts: []*genai.Part{genai.NewPartFromText(system)},
		}
	}
	if cfg.Temperature != nil {
		t := float32(*cfg.Temperature)
		config.Temperature = &t
	}
	if cfg.MaxTokens != nil {
		mt := int32(*cfg.MaxTokens)
		config.MaxOutputTokens = mt
	}

	// Convert tools
	if len(tools) > 0 {
		var funcDecls []*genai.FunctionDeclaration
		for _, t := range tools {
			props := map[string]*genai.Schema{}
			for k, v := range t.Parameters {
				props[k] = toolParamToGenAISchema(v)
			}
			funcDecls = append(funcDecls, &genai.FunctionDeclaration{
				Name:        t.Name,
				Description: t.Description,
				Parameters: &genai.Schema{
					Type:       genai.TypeObject,
					Properties: props,
					Required:   t.Required,
				},
			})
		}
		config.Tools = []*genai.Tool{
			{FunctionDeclarations: funcDecls},
		}
		if opts.RequireToolCall {
			config.ToolConfig = &genai.ToolConfig{
				FunctionCallingConfig: &genai.FunctionCallingConfig{
					Mode: genai.FunctionCallingConfigModeAny,
				},
			}
		}
	}

	resp, err := client.Models.GenerateContent(ctx, cfg.Model, contents, config)
	if err != nil {
		return nil, fmt.Errorf("google generate: %w", err)
	}

	result := &LLMResponse{}
	for _, cand := range resp.Candidates {
		if cand.Content == nil {
			continue
		}
		for _, part := range cand.Content.Parts {
			if part.Text != "" {
				result.Content += part.Text
			}
			if part.FunctionCall != nil {
				args := map[string]interface{}{}
				for k, v := range part.FunctionCall.Args {
					args[k] = v
				}
				result.ToolCalls = append(result.ToolCalls, ToolCall{
					ID:   part.FunctionCall.Name,
					Name: part.FunctionCall.Name,
					Args: args,
				})
			}
		}
	}

	var inputTokens, outputTokens int
	if resp.UsageMetadata != nil {
		inputTokens = int(resp.UsageMetadata.PromptTokenCount)
		outputTokens = int(resp.UsageMetadata.CandidatesTokenCount)
	}
	result.Usage = TokenUsageInfo{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		Model:        cfg.Model,
		Provider:     "google",
		Cost:         EstimateCost(cfg.Model, inputTokens, outputTokens),
	}

	return result, nil
}

func toolParamToGenAISchema(p *ToolParameter) *genai.Schema {
	if p == nil {
		return &genai.Schema{Type: genai.TypeString}
	}
	s := &genai.Schema{Description: p.Description}
	switch p.Type {
	case "string":
		s.Type = genai.TypeString
		if len(p.Enum) > 0 {
			s.Enum = p.Enum
		}
	case "number", "integer":
		s.Type = genai.TypeNumber
	case "boolean":
		s.Type = genai.TypeBoolean
	case "array":
		s.Type = genai.TypeArray
		if p.Items != nil {
			s.Items = toolParamToGenAISchema(p.Items)
		}
	case "object":
		s.Type = genai.TypeObject
		if len(p.Properties) > 0 {
			props := map[string]*genai.Schema{}
			for k, v := range p.Properties {
				props[k] = toolParamToGenAISchema(v)
			}
			s.Properties = props
		}
		s.Required = p.Required
	default:
		s.Type = genai.TypeString
	}
	return s
}
