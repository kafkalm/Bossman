import { z } from "zod";
import { streamLLM, getDefaultModelConfig } from "@/core/llm";

const GenerateSchema = z.object({
  mode: z.enum(["generate", "refine"]),
  instruction: z.string().min(1),
  currentPrompt: z.string().optional(),
  roleTitle: z.string().optional(),
});

const SYSTEM_PROMPT = `You are an expert at writing system prompts for AI agents in a company simulation platform called Bossman. 

In Bossman, each AI agent plays a specific role (like CEO, Frontend Developer, Researcher, etc.) in an AI company. They collaborate to complete projects assigned by the user (the Founder).

Your job is to write or refine high-quality system prompts for these agent roles.

## Rules for great agent prompts:
1. Start with a clear identity statement: "You are the [Role Title] in an AI-powered company."
2. Include a "Responsibilities" section with numbered, specific duties.
3. Include a "Working Style" section that defines behavioral guidelines.
4. Include an "Output Format" section that specifies how the agent should structure its responses.
5. Be specific and actionable — avoid vague instructions.
6. Use markdown formatting with clear headings (##).
7. Keep the prompt focused on the role's domain expertise.
8. The prompt should help the agent produce structured, useful output that other agents can build upon.

When GENERATING a new prompt: create a complete, production-ready system prompt based on the user's description.
When REFINING an existing prompt: improve clarity, structure, specificity, and completeness while preserving the user's intent. Apply the rules above.

IMPORTANT: Output ONLY the system prompt text. No explanations, no wrapping, no markdown code blocks — just the prompt content itself.`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = GenerateSchema.parse(body);

    const config = getDefaultModelConfig();
    if (!config) {
      return Response.json(
        { error: "No default LLM configured. Please set DEFAULT_LLM_PROVIDER and DEFAULT_LLM_MODEL in your .env, or add at least one API key." },
        { status: 400 }
      );
    }

    let userMessage: string;
    if (input.mode === "generate") {
      userMessage = `Generate a system prompt for an AI agent role${input.roleTitle ? ` called "${input.roleTitle}"` : ""}.

User's description of the role:
${input.instruction}`;
    } else {
      userMessage = `Refine the following system prompt${input.roleTitle ? ` for the "${input.roleTitle}" role` : ""}.

User's refinement instructions:
${input.instruction}

Current prompt to refine:
---
${input.currentPrompt ?? ""}
---`;
    }

    const result = streamLLM({
      config,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    return result.toTextStreamResponse();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to generate prompt" },
      { status: 500 }
    );
  }
}
