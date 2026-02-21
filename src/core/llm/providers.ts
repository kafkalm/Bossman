import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, streamText, tool, type ModelMessage } from "ai";
import { z } from "zod";
import type {
  ModelConfig,
  LLMProvider,
  LLMResponse,
  TokenUsageInfo,
  ToolDefinition,
  ChatMessage,
} from "./types";

// ─── Provider Registry ───────────────────────────────────────────────────────

function getLanguageModel(config: ModelConfig) {
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return openai(config.model);
    }

    case "anthropic": {
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey?.trim()) {
        throw new Error(
          "ANTHROPIC_API_KEY is not set. Add it to your .env file (see Settings → LLM providers for the key URL)."
        );
      }
      const anthropic = createAnthropic({ apiKey: anthropicApiKey });
      return anthropic(config.model);
    }

    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      return google(config.model);
    }

    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return openrouter.chat(config.model); // use Chat Completions API, not Responses API
    }

    case "deepseek": {
      const deepseek = createOpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: "https://api.deepseek.com",
      });
      return deepseek.chat(config.model); // use Chat Completions API, not Responses API
    }

    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

// ─── Convert tool definitions to AI SDK format ───────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTools(tools: ToolDefinition[]): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};
  for (const t of tools) {
    result[t.name] = tool({
      description: t.description,
      inputSchema: t.parameters instanceof z.ZodType ? t.parameters : z.object({}),
    });
  }
  return result;
}

// ─── Convert chat messages to AI SDK format ──────────────────────────────────

function convertMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    const role = msg.role === "system" ? "system" as const
      : msg.role === "assistant" ? "assistant" as const
      : "user" as const;

    // If content is a simple string, pass through directly
    if (typeof msg.content === "string") {
      return { role, content: msg.content };
    }

    // Multipart content (text + image parts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = msg.content.map((part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text };
      }
      if (part.type === "image") {
        return { type: "image" as const, image: new URL(part.url) };
      }
      return { type: "text" as const, text: String(part) };
    });

    return { role, content: parts };
  }) as ModelMessage[];
}

// ─── Estimate cost ───────────────────────────────────────────────────────────

function estimateCost(
  _provider: LLMProvider,
  model: string,
  inputTokens: number,
  outputTokens: number
): number | undefined {
  // Rough cost estimates per 1M tokens (input/output)
  const costs: Record<string, { input: number; output: number }> = {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "claude-4-opus-20250514": { input: 15, output: 75 },
    "claude-4-sonnet-20250514": { input: 3, output: 15 },
    "claude-sonnet-4-20250514": { input: 3, output: 15 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "deepseek-chat": { input: 0.14, output: 0.28 },
    "deepseek-reasoner": { input: 0.55, output: 2.19 },
  };

  const modelCost = costs[model];
  if (!modelCost) return undefined;

  return (
    (inputTokens / 1_000_000) * modelCost.input +
    (outputTokens / 1_000_000) * modelCost.output
  );
}

// ─── Main LLM call function ─────────────────────────────────────────────────

export async function callLLM(options: {
  config: ModelConfig;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  system?: string;
}): Promise<LLMResponse> {
  const { config, messages, tools: toolDefs, system } = options;
  const model = getLanguageModel(config);
  const coreMessages = convertMessages(messages);

  const aiTools = toolDefs ? convertTools(toolDefs) : undefined;

  const result = await generateText({
    model,
    messages: coreMessages,
    tools: aiTools,
    system,
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens,
  });

  const inputTokens = result.usage?.inputTokens ?? 0;
  const outputTokens = result.usage?.outputTokens ?? 0;

  const usage: TokenUsageInfo = {
    inputTokens,
    outputTokens,
    model: config.model,
    provider: config.provider,
    cost: estimateCost(config.provider, config.model, inputTokens, outputTokens),
  };

  const toolCalls = result.toolCalls?.map((tc) => ({
    id: tc.toolCallId,
    name: tc.toolName,
    args: (tc as Record<string, unknown>).input as Record<string, unknown> ?? {},
  }));

  return {
    content: result.text ?? "",
    toolCalls: toolCalls?.length ? toolCalls : undefined,
    usage,
  };
}

// ─── Streaming variant ───────────────────────────────────────────────────────

export function streamLLM(options: {
  config: ModelConfig;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  system?: string;
}) {
  const { config, messages, tools: toolDefs, system } = options;
  const model = getLanguageModel(config);
  const coreMessages = convertMessages(messages);
  const aiTools = toolDefs ? convertTools(toolDefs) : undefined;

  return streamText({
    model,
    messages: coreMessages,
    tools: aiTools,
    system,
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens,
  });
}
