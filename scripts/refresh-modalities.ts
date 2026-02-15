/**
 * One-time script to refresh model capabilities (inputModalities / outputModalities)
 * for all existing AgentRoles in the database.
 *
 * Usage: npx tsx scripts/refresh-modalities.ts
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient();

// Known model-to-OpenRouter mapping
const providerModelMapping: Record<string, string> = {
  "claude-4-opus-20250514": "anthropic/claude-4-opus",
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
  "claude-4-sonnet-20250514": "anthropic/claude-sonnet-4",
  "claude-3.5-sonnet-20241022": "anthropic/claude-3.5-sonnet",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-4-turbo": "openai/gpt-4-turbo",
  "o3-mini": "openai/o3-mini",
  "o3": "openai/o3",
  "gemini-2.0-flash": "google/gemini-2.0-flash-001",
  "gemini-2.5-pro-preview-05-06": "google/gemini-2.5-pro-preview-05-06",
  "gemini-2.5-flash-preview-05-20": "google/gemini-2.5-flash-preview-05-20",
  "deepseek-chat": "deepseek/deepseek-chat",
  "deepseek-reasoner": "deepseek/deepseek-reasoner",
};

function resolveModelId(provider: string, model: string): string {
  if (provider === "openrouter") return model;
  if (providerModelMapping[model]) return providerModelMapping[model];
  const prefixMap: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    google: "google",
    deepseek: "deepseek",
  };
  const prefix = prefixMap[provider];
  return prefix ? `${prefix}/${model}` : model;
}

interface OpenRouterModel {
  id: string;
  name: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

async function main() {
  console.log("Fetching OpenRouter model catalog...");

  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status}`);
  }

  const data = await res.json();
  const modelsMap = new Map<string, OpenRouterModel>();
  for (const m of data.data ?? []) {
    modelsMap.set(m.id, m);
  }

  console.log(`Loaded ${modelsMap.size} models from OpenRouter.\n`);

  const roles = await prisma.agentRole.findMany();
  console.log(`Found ${roles.length} roles in database.\n`);

  let updated = 0;

  for (const role of roles) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(role.modelConfig);
    } catch {
      console.log(`  ⚠ ${role.title}: invalid modelConfig JSON, skipping`);
      continue;
    }

    const provider = (config.provider as string) ?? "";
    const model = (config.model as string) ?? "";

    if (!provider || !model) {
      console.log(`  ⚠ ${role.title}: missing provider/model, skipping`);
      continue;
    }

    const resolvedId = resolveModelId(provider, model);

    // Try exact match, then partial
    let modelInfo = modelsMap.get(resolvedId);
    if (!modelInfo) {
      for (const [key, val] of modelsMap) {
        if (key.includes(resolvedId) || resolvedId.includes(key)) {
          modelInfo = val;
          break;
        }
      }
    }

    const inputModalities = modelInfo?.architecture?.input_modalities ?? ["text"];
    const outputModalities = modelInfo?.architecture?.output_modalities ?? ["text"];

    const newConfig = {
      ...config,
      inputModalities,
      outputModalities,
    };

    await prisma.agentRole.update({
      where: { id: role.id },
      data: { modelConfig: JSON.stringify(newConfig) },
    });

    const matchTag = modelInfo ? `✓ matched → ${modelInfo.id}` : "✗ no match, defaulting to text";
    console.log(
      `  ${role.title} (${provider}/${model}): ${matchTag}\n` +
      `    input: [${inputModalities.join(", ")}]  output: [${outputModalities.join(", ")}]`
    );
    updated++;
  }

  console.log(`\nDone. Updated ${updated}/${roles.length} roles.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
