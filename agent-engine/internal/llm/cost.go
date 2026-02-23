package llm

// modelCostTable maps model name → cost per 1M tokens (input, output) in USD
var modelCostTable = map[string][2]float64{
	"gpt-4o":                      {2.5, 10},
	"gpt-4o-mini":                 {0.15, 0.6},
	"o3-mini":                     {1.1, 4.4},
	"claude-4-opus-20250514":      {15, 75},
	"claude-4-sonnet-20250514":    {3, 15},
	"claude-sonnet-4-20250514":    {3, 15},
	"claude-3-5-sonnet-20241022":  {3, 15},
	"claude-3-5-haiku-20241022":   {0.8, 4},
	"gemini-2.0-flash":            {0.1, 0.4},
	"gemini-1.5-pro":              {1.25, 5},
	"deepseek-chat":               {0.14, 0.28},
	"deepseek-reasoner":           {0.55, 2.19},
}

// EstimateCost calculates cost in USD for a given model and token counts
func EstimateCost(model string, inputTokens, outputTokens int) *float64 {
	costs, ok := modelCostTable[model]
	if !ok {
		return nil
	}
	c := (float64(inputTokens)/1_000_000)*costs[0] +
		(float64(outputTokens)/1_000_000)*costs[1]
	return &c
}
