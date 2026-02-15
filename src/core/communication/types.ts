export type MessageType =
  | "task_assignment"
  | "discussion"
  | "review"
  | "decision"
  | "deliverable"
  | "status_update"
  | "request_info"
  | "founder_message";

export interface BusMessage {
  projectId: string;
  taskId?: string;
  senderId?: string;
  senderType: "founder" | "agent" | "system";
  messageType: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
}
