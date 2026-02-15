import type { ModelConfig, LLMProvider } from "./types";

const VALID_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
]);

/**
 * Get the default LLM model config for system-level features
 * (Prompt generation, etc.), separate from each Agent's own config.
 *
 * Reads from DEFAULT_LLM_PROVIDER + DEFAULT_LLM_MODEL env vars.
 * Falls back to auto-detecting an available provider from API keys.
 */
export function getDefaultModelConfig(): ModelConfig | null {
  const provider = process.env.DEFAULT_LLM_PROVIDER;
  const model = process.env.DEFAULT_LLM_MODEL;

  if (provider && model && VALID_PROVIDERS.has(provider)) {
    return {
      provider: provider as LLMProvider,
      model,
      temperature: 0.7,
    };
  }

  // Fallback: auto-detect from available API keys
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", model: "claude-sonnet-4-20250514", temperature: 0.7 };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", model: "gpt-4o", temperature: 0.7 };
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { provider: "google", model: "gemini-2.0-flash", temperature: 0.7 };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return { provider: "deepseek", model: "deepseek-chat", temperature: 0.7 };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: "openrouter", model: "anthropic/claude-sonnet-4-20250514", temperature: 0.7 };
  }

  return null;
}
