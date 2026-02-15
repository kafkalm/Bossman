import { prisma } from "@/lib/db";
import type { BusMessage } from "./types";

type MessageHandler = (message: BusMessage & { id: string; createdAt: Date }) => void;

/**
 * MessageBus handles inter-agent communication.
 * All messages are persisted to the database and can be subscribed to.
 */
export class MessageBus {
  private handlers: Map<string, MessageHandler[]> = new Map();

  /**
   * Send a message through the bus.
   * Persists to DB and notifies subscribers.
   */
  async send(message: BusMessage): Promise<string> {
    // Persist to database
    const dbMessage = await prisma.message.create({
      data: {
        projectId: message.projectId,
        taskId: message.taskId,
        senderId: message.senderId,
        senderType: message.senderType,
        content: message.content,
        metadata: message.metadata ? JSON.stringify(message.metadata) : null,
      },
    });

    // Notify project subscribers
    const projectHandlers = this.handlers.get(message.projectId) ?? [];
    for (const handler of projectHandlers) {
      handler({
        ...message,
        id: dbMessage.id,
        createdAt: dbMessage.createdAt,
      });
    }

    // Notify global subscribers
    const globalHandlers = this.handlers.get("*") ?? [];
    for (const handler of globalHandlers) {
      handler({
        ...message,
        id: dbMessage.id,
        createdAt: dbMessage.createdAt,
      });
    }

    return dbMessage.id;
  }

  /**
   * Subscribe to messages for a project (or "*" for all).
   */
  subscribe(projectId: string, handler: MessageHandler): () => void {
    const existing = this.handlers.get(projectId) ?? [];
    existing.push(handler);
    this.handlers.set(projectId, existing);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(projectId) ?? [];
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    };
  }

  /**
   * Get message history for a project.
   */
  async getProjectMessages(projectId: string, options?: { taskId?: string; limit?: number }) {
    return prisma.message.findMany({
      where: {
        projectId,
        ...(options?.taskId ? { taskId: options.taskId } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: options?.limit ?? 100,
      include: {
        sender: { include: { role: true } },
      },
    });
  }
}

// Singleton
export const messageBus = new MessageBus();
