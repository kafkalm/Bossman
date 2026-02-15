import type { ModelConfig, ToolDefinition, ChatMessage, LLMResponse } from "@/core/llm/types";

// ─── Agent Role Definition ───────────────────────────────────────────────────

export interface AgentRoleDefinition {
  name: string; // unique key, e.g. "ceo"
  title: string; // display name, e.g. "CEO"
  systemPrompt: string;
  defaultModelConfig: ModelConfig;
  capabilities?: string[]; // list of tool names this role can use
}

// ─── Agent Execution Context ─────────────────────────────────────────────────

export interface AgentExecutionContext {
  employeeId: string;
  employeeName: string;
  roleName: string;
  roleTitle: string;
  projectId: string;
  projectName: string;
  projectDescription: string;
  taskId?: string;
  taskTitle?: string;
  taskDescription?: string;
}

// ─── Agent Run Result ────────────────────────────────────────────────────────

export interface AgentRunResult {
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
    provider: string;
    cost?: number;
  };
}

// ─── Agent Event (for streaming / monitoring) ────────────────────────────────

export type AgentEventType =
  | "agent:start"
  | "agent:thinking"
  | "agent:tool_call"
  | "agent:tool_result"
  | "agent:response"
  | "agent:complete"
  | "agent:error";

export interface AgentEvent {
  type: AgentEventType;
  employeeId: string;
  projectId: string;
  taskId?: string;
  data: unknown;
  timestamp: Date;
}
