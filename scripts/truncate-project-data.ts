import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

type Args = {
  projectId?: string;
  yes: boolean;
};

const prisma = new PrismaClient();

function parseArgs(argv: string[]): Args {
  const args: Args = { yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--project-id" || a === "-p") && argv[i + 1]) {
      args.projectId = argv[i + 1];
      i++;
      continue;
    }
    if (a === "--yes" || a === "-y") {
      args.yes = true;
    }
  }
  return args;
}

async function loadExistingTables(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  );
  return new Set(rows.map((r) => r.name));
}

async function execIfTableExists(
  existingTables: Set<string>,
  table: string,
  sql: string,
  ...params: unknown[]
): Promise<number> {
  if (!existingTables.has(table)) {
    return 0;
  }
  const affected = await prisma.$executeRawUnsafe(sql, ...params);
  return Number(affected ?? 0);
}

async function truncateProjectData(projectId?: string): Promise<void> {
  const hasScope = !!projectId;
  const scopeText = hasScope ? `projectId=${projectId}` : "ALL projects";
  console.log(`[truncate-project-data] scope: ${scopeText}`);

  const totals: Record<string, number> = {};
  const existingTables = await loadExistingTables();

  const add = (k: string, n: number) => {
    totals[k] = (totals[k] ?? 0) + n;
  };

  if (hasScope) {
    add("EmployeeInbox", await execIfTableExists(existingTables, "EmployeeInbox", `DELETE FROM "EmployeeInbox" WHERE "projectId" = ?`, projectId));
    add("ConversationMessage", await execIfTableExists(existingTables, "ConversationMessage", `DELETE FROM "ConversationMessage" WHERE "projectId" = ?`, projectId));
    add("ConversationThread", await execIfTableExists(existingTables, "ConversationThread", `DELETE FROM "ConversationThread" WHERE "projectId" = ?`, projectId));
    add("EngineTimelineEvent", await execIfTableExists(existingTables, "EngineTimelineEvent", `DELETE FROM "EngineTimelineEvent" WHERE "projectId" = ?`, projectId));
    add("TaskTransition", await execIfTableExists(existingTables, "TaskTransition", `DELETE FROM "TaskTransition" WHERE "projectId" = ?`, projectId));
    add("ProjectTransition", await execIfTableExists(existingTables, "ProjectTransition", `DELETE FROM "ProjectTransition" WHERE "projectId" = ?`, projectId));
    add("ProjectFile", await execIfTableExists(existingTables, "ProjectFile", `DELETE FROM "ProjectFile" WHERE "projectId" = ?`, projectId));
    add("Message", await execIfTableExists(existingTables, "Message", `DELETE FROM "Message" WHERE "projectId" = ?`, projectId));
    add("TokenUsage", await execIfTableExists(existingTables, "TokenUsage", `DELETE FROM "TokenUsage" WHERE "projectId" = ?`, projectId));
    add(
      "TaskAssignment",
      await execIfTableExists(
        existingTables,
        "TaskAssignment",
        `DELETE FROM "TaskAssignment" WHERE "taskId" IN (SELECT "id" FROM "Task" WHERE "projectId" = ?)`,
        projectId
      )
    );
    add("Task", await execIfTableExists(existingTables, "Task", `DELETE FROM "Task" WHERE "projectId" = ? AND "parentId" IS NOT NULL`, projectId));
    add("Task", await execIfTableExists(existingTables, "Task", `DELETE FROM "Task" WHERE "projectId" = ?`, projectId));
    add("Project", await execIfTableExists(existingTables, "Project", `DELETE FROM "Project" WHERE "id" = ?`, projectId));
  } else {
    add("EmployeeInbox", await execIfTableExists(existingTables, "EmployeeInbox", `DELETE FROM "EmployeeInbox"`));
    add("ConversationMessage", await execIfTableExists(existingTables, "ConversationMessage", `DELETE FROM "ConversationMessage"`));
    add("ConversationThread", await execIfTableExists(existingTables, "ConversationThread", `DELETE FROM "ConversationThread"`));
    add("EngineTimelineEvent", await execIfTableExists(existingTables, "EngineTimelineEvent", `DELETE FROM "EngineTimelineEvent"`));
    add("TaskTransition", await execIfTableExists(existingTables, "TaskTransition", `DELETE FROM "TaskTransition"`));
    add("ProjectTransition", await execIfTableExists(existingTables, "ProjectTransition", `DELETE FROM "ProjectTransition"`));
    add("ProjectFile", await execIfTableExists(existingTables, "ProjectFile", `DELETE FROM "ProjectFile"`));
    add("Message", await execIfTableExists(existingTables, "Message", `DELETE FROM "Message"`));
    add("TokenUsage", await execIfTableExists(existingTables, "TokenUsage", `DELETE FROM "TokenUsage"`));
    add("TaskAssignment", await execIfTableExists(existingTables, "TaskAssignment", `DELETE FROM "TaskAssignment"`));
    add("Task", await execIfTableExists(existingTables, "Task", `DELETE FROM "Task" WHERE "parentId" IS NOT NULL`));
    add("Task", await execIfTableExists(existingTables, "Task", `DELETE FROM "Task"`));
    add("Project", await execIfTableExists(existingTables, "Project", `DELETE FROM "Project"`));
  }

  console.log("[truncate-project-data] done.");
  for (const [table, count] of Object.entries(totals)) {
    console.log(`  - ${table}: ${count}`);
  }
  console.log("[truncate-project-data] untouched tables: Company, Employee, AgentRole, Skill and related role/employee skill mappings.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.yes) {
    console.error(
      "Refusing to run without confirmation. Re-run with --yes.\n" +
        "Examples:\n" +
        "  npx tsx scripts/truncate-project-data.ts --yes\n" +
        "  npx tsx scripts/truncate-project-data.ts --project-id <projectId> --yes"
    );
    process.exit(1);
  }

  await truncateProjectData(args.projectId);
}

main()
  .catch((error) => {
    console.error("[truncate-project-data] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
