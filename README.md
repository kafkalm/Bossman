# Bossman

Build and manage your AI-powered company. Bossman lets you assemble a team of AI agents — each with a dedicated role — that collaborate to complete complex projects, just like a real company.

## Concept

Inspired by how humans organize into companies to tackle complex projects, Bossman lets you:

- **Create AI companies** with specialized agent employees (CEO, PM, Frontend Dev, Backend Dev, UI Designer, QA Engineer)
- **Propose projects** as the Founder, and watch the CEO decompose tasks, assign them to team members, and coordinate execution
- **Monitor progress** through a real-time chat interface, task kanban board, and token usage analytics
- **Customize roles** by creating new agent types with custom system prompts and model configurations

## Tech Stack

- **Framework**: Next.js 15 (App Router) — TypeScript full-stack
- **UI**: shadcn/ui + Tailwind CSS 4
- **LLM**: Vercel AI SDK — supports OpenAI, Anthropic, Google, OpenRouter, DeepSeek
- **Database**: Prisma ORM — SQLite (default) or PostgreSQL
- **State**: zustand + React Server Components

## Getting Started

### Prerequisites

- Node.js 18+
- An API key from at least one LLM provider

### Installation

```bash
git clone https://github.com/kafkalm/Bossman.git
cd Bossman
npm install
```

### Configuration

Copy the environment template and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` and add at least one API key:

```env
DATABASE_URL="file:./dev.db"

OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=AI...
OPENROUTER_API_KEY=sk-or-...
DEEPSEEK_API_KEY=sk-...
```

### Database Setup

```bash
npx prisma migrate dev
npm run db:seed
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Create a Company** — Go to Companies → New Company. A default team (CEO, PM, UI Designer, Frontend Dev, Backend Dev, QA) is automatically created.

2. **Create a Project** — Navigate to your company → New Project. Describe what you want to build in detail.

3. **Start the Project** — Click "Start Project". The CEO agent will analyze your requirements, create an execution plan, and begin assigning tasks to team members.

4. **Monitor & Interact** — Watch the chat for real-time agent communication. Send messages to the CEO to provide guidance or adjust direction. Switch to the Kanban view to see task progress.

5. **Review Analytics** — Visit the Analytics page to see token consumption by agent, project, and model.

## Built-in Agent Roles

| Role | Responsibility |
|---|---|
| **CEO** | Project analysis, task decomposition, coordination, quality control |
| **Product Manager** | Requirements analysis, PRD creation, scope & priority definition |
| **UI Designer** | UI/UX design, layouts, interaction patterns |
| **Frontend Developer** | Frontend implementation, components, responsive design |
| **Backend Developer** | API design, database schema, server-side logic |
| **QA Engineer** | Test strategy, test cases, quality assurance |

Each role can be configured with a different LLM model. The CEO uses a higher-capability model by default.

## Project Structure

```
src/
├── app/                    # Next.js pages & API routes
│   ├── api/                # REST API
│   ├── company/            # Company management UI
│   ├── project/            # Project management UI
│   ├── analytics/          # Token usage analytics
│   └── settings/           # LLM & role configuration
├── core/                   # Business logic (framework-agnostic)
│   ├── agent/              # Agent system (registry, runtime, roles)
│   ├── company/            # Company management
│   ├── project/            # Project & workflow engine
│   ├── communication/      # Message bus
│   └── llm/                # Unified LLM interface
├── components/             # React UI components
│   ├── ui/                 # shadcn/ui base components
│   └── layout/             # Layout components
└── lib/                    # Shared utilities
```

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed built-in roles
npm run db:studio    # Open Prisma Studio
```

## License

MIT
