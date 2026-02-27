-- Agent engine core refactor: status machine + async communication + timeline

-- Normalize legacy statuses
UPDATE "Project" SET "status" = 'active' WHERE "status" IN ('planning', 'in_progress');
UPDATE "Project" SET "status" = 'done' WHERE "status" = 'completed';
UPDATE "Project" SET "status" = 'blocked' WHERE "status" = 'failed';
UPDATE "Project" SET "status" = 'canceled' WHERE "status" = 'cancelled';
UPDATE "Project" SET "status" = 'blocked' WHERE "status" NOT IN ('active', 'review', 'done', 'blocked', 'canceled');

UPDATE "Task" SET "status" = 'todo' WHERE "status" IN ('created', 'ready', 'pending', 'assigned');
UPDATE "Task" SET "status" = 'done' WHERE "status" = 'completed';
UPDATE "Task" SET "status" = 'canceled' WHERE "status" = 'cancelled';
UPDATE "Task" SET "status" = 'blocked' WHERE "status" NOT IN ('todo', 'in_progress', 'review', 'done', 'blocked', 'canceled');

-- Transition logs
CREATE TABLE IF NOT EXISTS "project_transitions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_transitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "task_transitions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_transitions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "task_transitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Async communication
CREATE TABLE IF NOT EXISTS "conversation_threads" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT,
  "subject" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "conversation_threads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "conversation_threads_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "conversation_threads_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "conversation_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "threadId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT,
  "fromEmployeeId" TEXT,
  "toEmployeeId" TEXT,
  "messageType" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "payload" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "conversation_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "conversation_messages_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "conversation_messages_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "conversation_messages_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "employee_inbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "employeeId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT,
  "threadId" TEXT,
  "messageId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "employee_inbox_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employee_inbox_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "employee_inbox_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "employee_inbox_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "conversation_threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "employee_inbox_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "conversation_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Timeline
CREATE TABLE IF NOT EXISTS "engine_timeline_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT,
  "eventType" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "payload" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "engine_timeline_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "engine_timeline_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "project_transitions_projectId_createdAt_idx" ON "project_transitions"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "task_transitions_projectId_createdAt_idx" ON "task_transitions"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "employee_inbox_employeeId_projectId_status_idx" ON "employee_inbox"("employeeId", "projectId", "status");
CREATE INDEX IF NOT EXISTS "conversation_messages_projectId_createdAt_idx" ON "conversation_messages"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "engine_timeline_events_projectId_createdAt_idx" ON "engine_timeline_events"("projectId", "createdAt");
