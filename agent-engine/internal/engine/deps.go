package engine

import (
	"github.com/kafkalm/bossman/agent-engine/internal/agent"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
	"github.com/kafkalm/bossman/agent-engine/internal/workspace"
)

// Deps is the dependency container passed through the engine
type Deps struct {
	DB        *db.DB
	Bus       *bus.Bus
	LLM       *llm.Registry
	Workspace *workspace.Workspace
	Runtime   *agent.Runtime
}

// NewDeps creates the Deps container
func NewDeps(database *db.DB, msgBus *bus.Bus, llmRegistry *llm.Registry, ws *workspace.Workspace) *Deps {
	return &Deps{
		DB:        database,
		Bus:       msgBus,
		LLM:       llmRegistry,
		Workspace: ws,
		Runtime:   agent.New(database, llmRegistry),
	}
}
