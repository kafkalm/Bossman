import type { ChatMessage } from "@/core/llm/types";
import { prisma } from "@/lib/db";
import type { AgentExecutionContext } from "./types";

const MAX_CONTEXT_MESSAGES = 50;

/**
 * Builds the conversation context for an agent working on a task.
 * Gathers relevant messages from the project/task and formats them
 * as chat messages for the LLM.
 */
export async function buildAgentContext(
  ctx: AgentExecutionContext
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];

  // 1. Add project context as a user message
  messages.push({
    role: "user",
    content: formatProjectContext(ctx),
  });

  // 2. Fetch relevant messages from the database
  const dbMessages = await prisma.message.findMany({
    where: {
      projectId: ctx.projectId,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: MAX_CONTEXT_MESSAGES,
    include: {
      sender: { include: { role: true } },
    },
  });

  // 3. Convert DB messages to chat messages
  for (const msg of dbMessages) {
    const senderLabel =
      msg.senderType === "founder"
        ? "Founder"
        : msg.senderType === "system"
          ? "System"
          : msg.sender
            ? `${msg.sender.name} (${msg.sender.role.title})`
            : "Unknown";

    if (msg.senderType === "agent" && msg.senderId === ctx.employeeId) {
      // This agent's own messages become assistant messages
      messages.push({
        role: "assistant",
        content: msg.content,
      });
    } else {
      // Other messages become user messages with sender labels
      messages.push({
        role: "user",
        content: `[${senderLabel}]: ${msg.content}`,
      });
    }
  }

  return messages;
}

/**
 * Formats the project/task context into a readable string.
 */
function formatProjectContext(ctx: AgentExecutionContext): string {
  let context = `You are ${ctx.employeeName}, serving as ${ctx.roleTitle} in this project.\n\n`;
  context += `## Project: ${ctx.projectName}\n${ctx.projectDescription}\n\n`;

  if (ctx.taskTitle && ctx.taskDescription) {
    context += `## Your Current Task: ${ctx.taskTitle}\n${ctx.taskDescription}\n\n`;
  }

  context += `## Your Workspace\n`;
  context += `You have a personal workspace (your folder in the project's Document/Code tab). Save your work there as you go:\n`;
  context += `- Use **save_to_workspace** to save drafts, outlines, research notes, and intermediate code. Call it frequently so work is persisted (e.g. path "drafts", title "outline.md").\n`;
  context += `- Use **create_file** for final deliverables to submit to the CEO. Use optional path to organize (e.g. path "src", title "Button.tsx").\n`;
  context += `- Organize with path: "docs", "drafts", "src", "research", etc. (no leading/trailing slash).\n\n`;
  context += `Please complete your assigned work. Be thorough and professional.`;

  return context;
}

/**
 * Trims messages if the total is too long, keeping the system context
 * and the most recent messages.
 */
export function trimContext(
  messages: ChatMessage[],
  maxMessages: number = MAX_CONTEXT_MESSAGES
): ChatMessage[] {
  if (messages.length <= maxMessages) return messages;

  // Always keep the first message (project context) and the last N messages
  const first = messages[0];
  const recent = messages.slice(-(maxMessages - 1));
  return [first, ...recent];
}
