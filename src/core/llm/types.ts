import { z } from "zod";

// ─── LLM Provider Configuration ──────────────────────────────────────────────

export const LLMProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
]);

export type LLMProvider = z.infer<typeof LLMProviderSchema>;

export const ModelConfigSchema = z.object({
  provider: LLMProviderSchema,
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ─── Token Usage ─────────────────────────────────────────────────────────────

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: LLMProvider;
  cost?: number;
}

// ─── Chat Messages ───────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ImagePart {
  type: "image";
  url: string; // data:image/... base64 URL or http URL
}

export interface TextPart {
  type: "text";
  text: string;
}

export type MessageContent = string | (TextPart | ImagePart)[];

export interface ChatMessage {
  role: ChatRole;
  content: MessageContent;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
}

// ─── LLM Response ────────────────────────────────────────────────────────────

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCallResult[];
  usage: TokenUsageInfo;
}

export interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
