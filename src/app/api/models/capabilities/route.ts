import { NextResponse } from "next/server";

/**
 * Model capabilities info returned by this endpoint.
 */
export interface ModelCapabilities {
  modelId: string;
  name: string;
  inputModalities: string[]; // e.g. ["text", "image", "audio", "pdf"]
  outputModalities: string[]; // e.g. ["text", "image"]
  contextLength?: number;
  maxCompletionTokens?: number;
}

/**
 * Known model-to-OpenRouter mapping for non-OpenRouter providers.
 * Helps resolve model IDs to OpenRouter's model catalog.
 */
const providerModelMapping: Record<string, string> = {
  // Anthropic
  "claude-4-opus-20250514": "anthropic/claude-4-opus",
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
  "claude-4-sonnet-20250514": "anthropic/claude-sonnet-4",
  "claude-3.5-sonnet-20241022": "anthropic/claude-3.5-sonnet",
  // OpenAI
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-4-turbo": "openai/gpt-4-turbo",
  "o3-mini": "openai/o3-mini",
  "o3": "openai/o3",
  // Google
  "gemini-2.0-flash": "google/gemini-2.0-flash-001",
  "gemini-2.5-pro-preview-05-06": "google/gemini-2.5-pro-preview-05-06",
  "gemini-2.5-flash-preview-05-20": "google/gemini-2.5-flash-preview-05-20",
  // DeepSeek
  "deepseek-chat": "deepseek/deepseek-chat",
  "deepseek-reasoner": "deepseek/deepseek-reasoner",
};

// In-memory cache: OpenRouter model list (refreshed every 10 minutes)
let cachedModels: Record<string, OpenRouterModel> | null = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface OpenRouterModel {
  id: string;
  name: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  context_length?: number;
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

async function fetchOpenRouterModels(): Promise<Record<string, OpenRouterModel>> {
  if (cachedModels && Date.now() - cacheTime < CACHE_TTL) {
    return cachedModels;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: process.env.OPENROUTER_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        : {},
    });

    if (!res.ok) throw new Error(`OpenRouter API returned ${res.status}`);

    const data = await res.json();
    const models: Record<string, OpenRouterModel> = {};
    for (const m of data.data ?? []) {
      models[m.id] = m;
    }

    cachedModels = models;
    cacheTime = Date.now();
    return models;
  } catch (error) {
    console.error("Failed to fetch OpenRouter models:", error);
    return cachedModels ?? {};
  }
}

function resolveModelId(provider: string, model: string): string {
  if (provider === "openrouter") {
    return model; // already in OpenRouter format
  }

  // Try direct mapping
  if (providerModelMapping[model]) {
    return providerModelMapping[model];
  }

  // Try provider/model format
  const providerPrefix: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    google: "google",
    deepseek: "deepseek",
  };

  const prefix = providerPrefix[provider];
  if (prefix) {
    return `${prefix}/${model}`;
  }

  return model;
}

// GET /api/models/capabilities?provider=xxx&model=xxx
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const model = searchParams.get("model");

  if (!provider || !model) {
    return NextResponse.json(
      { error: "provider and model are required" },
      { status: 400 }
    );
  }

  try {
    const allModels = await fetchOpenRouterModels();
    const resolvedId = resolveModelId(provider, model);

    // Try exact match first, then partial match
    let modelInfo = allModels[resolvedId];
    if (!modelInfo) {
      // Try fuzzy match: look for models that contain the resolved ID or vice versa
      const key = Object.keys(allModels).find(
        (k) => k.includes(resolvedId) || resolvedId.includes(k)
      );
      if (key) modelInfo = allModels[key];
    }

    if (!modelInfo) {
      // Return a default text-only capability
      return NextResponse.json({
        modelId: model,
        name: model,
        inputModalities: ["text"],
        outputModalities: ["text"],
      } satisfies ModelCapabilities);
    }

    const capabilities: ModelCapabilities = {
      modelId: modelInfo.id,
      name: modelInfo.name,
      inputModalities: modelInfo.architecture?.input_modalities ?? ["text"],
      outputModalities: modelInfo.architecture?.output_modalities ?? ["text"],
      contextLength: modelInfo.top_provider?.context_length ?? modelInfo.context_length,
      maxCompletionTokens: modelInfo.top_provider?.max_completion_tokens,
    };

    return NextResponse.json(capabilities);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch capabilities" },
      { status: 500 }
    );
  }
}
