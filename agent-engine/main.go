package main

import (
	"context"
	"log"
	"net/http"

	"github.com/kafkalm/bossman/agent-engine/internal/api"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/config"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/engine"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
	"github.com/kafkalm/bossman/agent-engine/internal/workspace"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	database, err := db.Open(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer database.Close()

	msgBus := bus.New()
	llmRegistry := llm.NewRegistry(cfg)
	ws := workspace.New(cfg.WorkspaceDir)

	deps := engine.NewDeps(database, msgBus, llmRegistry, ws)
	scheduler := engine.NewScheduler(deps)

	// Auto-resume any projects that were in_progress when the engine last stopped
	resumeCtx := context.Background()
	if projectIDs, err := database.GetInProgressProjectIDs(resumeCtx); err != nil {
		log.Printf("warning: could not load in-progress projects: %v", err)
	} else {
		for _, pid := range projectIDs {
			if err := scheduler.StartProject(pid); err != nil {
				log.Printf("warning: could not resume project %s: %v", pid, err)
			} else {
				log.Printf("resumed in-progress project %s", pid)
			}
		}
	}

	router := api.NewRouter(scheduler, msgBus)

	addr := ":" + cfg.Port
	log.Printf("Go Agent Engine listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
