# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint check

npm run db:migrate   # Run Prisma migrations
npm run db:push      # Push schema without migration
npm run db:seed      # Seed built-in agent roles
npm run db:studio    # Open Prisma Studio GUI
```

There is no test suite configured. `npm install` auto-runs `prisma generate` via postinstall.

## Architecture

**Bossman** is a multi-agent AI orchestration platform where users create virtual companies staffed with AI agents that collaboratively execute projects.

### Core Execution Model

The platform uses a goroutine-style concurrency model (`src/core/employee/goroutines.ts`). When a project starts (`POST /api/projects/[id]/start`):

1. `projectWorkflow.startProject()` is called
2. `launchProjectGoroutines()` spins up async loops for each employee
3. **CEO loop** (`ceo-cycle.ts`) runs first: decomposes requirements into tasks, assigns them to workers, reviews completed work
4. **Worker loops** (`worker-cycle.ts`) execute independently: pick up assigned tasks, do LLM-powered work, report back
5. A **mailbox** (`mailbox.ts`) provides wake-up signals between loops—agents sleep until signaled
6. The **message bus** (`communication/message-bus.ts`) broadcasts events over SSE to the frontend (`GET /api/projects/[id]/events`)

### Agent Tools

Agents interact via LLM tool calls (not direct function calls):
- CEO tools: `assign_task`, `approve_task`, `request_revision`, `complete_project`
- Worker tools: `report_to_ceo`, `create_file`, `update_file`

Tool handling lives in `ceo-cycle.ts` and `worker-cycle.ts`.

### LLM Abstraction

`src/core/llm/providers.ts` wraps the Vercel AI SDK to support Anthropic, OpenAI, Google, OpenRouter, and DeepSeek. Every LLM call records token usage via `token-tracker.ts` to `TokenUsage` DB records.

### Data Flow

- **SQLite** via Prisma (default; PostgreSQL-capable). Schema: `prisma/schema.prisma`
- Key models: `Company` → `Employee` (has `AgentRole`) → assigned to `Project` → executes `Task`s → produces `ProjectFile`s
- Tasks flow: `pending` → `assigned` → `in_progress` → `review` → `completed`

### Directory Map

| Path | Purpose |
|------|---------|
| `src/app/api/` | Next.js API routes (REST endpoints) |
| `src/core/agent/` | Agent role registry and runtime; built-in role definitions in `roles/` |
| `src/core/employee/` | Goroutine loops, CEO/worker cycles, mailbox, service layer |
| `src/core/project/` | Project workflow orchestration and state management |
| `src/core/llm/` | Unified LLM provider abstraction and token tracking |
| `src/core/communication/` | Internal pub/sub message bus |
| `src/core/workspace/` | Project file workspace management |
| `src/components/ui/` | shadcn/ui base components |
| `prisma/` | Schema, migrations, seed script |

### Built-in Agent Roles

Located in `src/core/agent/roles/`: CEO, Product Manager, UI Designer, Frontend Developer, Backend Developer, QA Engineer, Creative Director, Researcher. Each defines a system prompt and default model config.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict, path alias `@/*` → `src/*`)
- **Vercel AI SDK 6** with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`
- **Prisma 6** ORM + SQLite
- **shadcn/ui** + **Tailwind CSS 4** + **Radix UI**
- **Zustand** for client state
- **Zod 4** for schema validation

## Environment

Copy `.env.example` to `.env`. Key variables: LLM API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) and `DATABASE_URL` (defaults to SQLite).
