import { callLLM, recordTokenUsage } from "@/core/llm";
import type { ModelConfig, ToolDefinition, ChatMessage } from "@/core/llm/types";
import { prisma } from "@/lib/db";
import { buildAgentContext, trimContext } from "./context";
import type { AgentExecutionContext, AgentRunResult, AgentEvent } from "./types";

type EventHandler = (event: AgentEvent) => void;

/**
 * AgentRuntime: Executes an agent for a given task.
 *
 * 1. Loads the agent's role configuration from DB
 * 2. Builds conversation context (system prompt + messages)
 * 3. Calls the LLM with appropriate tools
 * 4. Records token usage
 * 5. Saves the response as a message
 */
export class AgentRuntime {
  private eventHandlers: EventHandler[] = [];

  onEvent(handler: EventHandler) {
    this.eventHandlers.push(handler);
  }

  private emit(event: AgentEvent) {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  /**
   * Run an agent to complete a task.
   */
  async run(options: {
    employeeId: string;
    projectId: string;
    taskId?: string;
    tools?: ToolDefinition[];
    additionalMessages?: ChatMessage[];
    modelConfigOverride?: ModelConfig;
  }): Promise<AgentRunResult> {
    const { employeeId, projectId, taskId, tools, additionalMessages, modelConfigOverride } =
      options;

    // 1. Load employee & role from DB
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { role: true },
    });

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });

    let task = null;
    if (taskId) {
      task = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
    }

    // 2. Parse model config
    const modelConfig: ModelConfig = modelConfigOverride ??
      (JSON.parse(employee.role.modelConfig) as ModelConfig);

    // 3. Build execution context
    const ctx: AgentExecutionContext = {
      employeeId: employee.id,
      employeeName: employee.name,
      roleName: employee.role.name,
      roleTitle: employee.role.title,
      projectId: project.id,
      projectName: project.name,
      projectDescription: project.description,
      taskId: task?.id,
      taskTitle: task?.title,
      taskDescription: task?.description,
    };

    this.emit({
      type: "agent:start",
      employeeId,
      projectId,
      taskId,
      data: { roleName: employee.role.title, employeeName: employee.name },
      timestamp: new Date(),
    });

    // 4. Mark employee as busy
    await prisma.employee.update({
      where: { id: employeeId },
      data: { status: "busy" },
    });

    try {
      // 5. Build context messages
      let messages = await buildAgentContext(ctx);

      // Add any additional messages
      if (additionalMessages) {
        messages = [...messages, ...additionalMessages];
      }

      // Trim if needed
      messages = trimContext(messages);

      // 6. Call LLM
      this.emit({
        type: "agent:thinking",
        employeeId,
        projectId,
        taskId,
        data: { messageCount: messages.length },
        timestamp: new Date(),
      });

      const response = await callLLM({
        config: modelConfig,
        messages,
        tools,
        system: employee.role.systemPrompt,
      });

      // 7. Record token usage
      await recordTokenUsage(employeeId, projectId, response.usage);

      // 8. Save response as a message (except for task executions - workflow handles those)
      if (response.content && !taskId) {
        await prisma.message.create({
          data: {
            projectId,
            taskId,
            senderId: employeeId,
            senderType: "agent",
            content: response.content,
            metadata: response.toolCalls
              ? JSON.stringify({ toolCalls: response.toolCalls })
              : null,
          },
        });
      }

      // 9. Task output/status and task execution messages are handled by the workflow
      //    tool calls (e.g. report_to_ceo). The actual deliverable may be in
      //    the tool call, not in response.content.

      this.emit({
        type: "agent:complete",
        employeeId,
        projectId,
        taskId,
        data: { usage: response.usage },
        timestamp: new Date(),
      });

      return {
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage,
      };
    } catch (error) {
      this.emit({
        type: "agent:error",
        employeeId,
        projectId,
        taskId,
        data: { error: error instanceof Error ? error.message : String(error) },
        timestamp: new Date(),
      });
      throw error;
    } finally {
      // Mark employee as idle
      await prisma.employee.update({
        where: { id: employeeId },
        data: { status: "idle" },
      });
    }
  }
}

// Singleton instance
export const agentRuntime = new AgentRuntime();
