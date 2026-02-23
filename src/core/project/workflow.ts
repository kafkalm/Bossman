/**
 * ProjectWorkflow: thin wrapper that delegates project execution to the Go engine.
 * The Go engine handles all agent goroutines, CEO/worker loops, and LLM calls.
 */

import { prisma } from "@/lib/db";
import { messageBus } from "@/core/communication/message-bus";
import { projectManager } from "./manager";

const GO_ENGINE_URL = process.env.GO_ENGINE_URL ?? "http://localhost:8080";

async function callGoEngine(path: string, body?: object): Promise<void> {
  try {
    await fetch(`${GO_ENGINE_URL}${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error(`[ProjectWorkflow] Go engine call to ${path} failed:`, err);
  }
}

export class ProjectWorkflow {
  /**
   * Called when a project is first created or manually started.
   * Persists the initial founder message and launches the Go engine goroutines.
   */
  async startProject(projectId: string): Promise<void> {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        company: { include: { employees: { include: { role: true } } } },
      },
    });

    const ceo = project.company.employees.find((e) => e.role.name === "ceo");
    if (!ceo) {
      throw new Error("No CEO found in the company. Please hire a CEO first.");
    }

    const brief = project.description
      ? `**${project.name}**\n\n${project.description}`
      : `**${project.name}**`;

    await messageBus.send({
      projectId,
      senderType: "founder",
      messageType: "founder_message",
      content: `I'd like to initiate this project: ${brief}`,
    });

    await projectManager.updateStatus(projectId, "in_progress");
    await callGoEngine(`/engine/projects/${projectId}/start`);
  }

  /**
   * Called on server startup to resume projects that were in_progress.
   */
  async resumeProject(projectId: string): Promise<void> {
    await callGoEngine(`/engine/projects/${projectId}/start`);
  }
}

export const projectWorkflow = new ProjectWorkflow();
