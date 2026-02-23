package main

import (
	"context"
	"log"
	"net/http"

	"github.com/kafkalm/bossman/agent-engine/internal/agent"
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

	runtime := agent.New(database, llmRegistry)
	svc := engine.NewService(database, msgBus, runtime, ws)

	ctx := context.Background()

	// Load all employees, instantiate CEO/Worker, register, and start loops
	employees, err := database.GetAllEmployeesWithRoles(ctx)
	if err != nil {
		log.Fatalf("failed to load employees: %v", err)
	}
	for _, emp := range employees {
		var e engine.Employee
		if emp.RoleName == "ceo" {
			e = engine.NewCEO(emp, svc)
		} else {
			e = engine.NewWorker(emp, svc)
		}
		svc.Register(e)
		go e.Loop(ctx)
	}
	log.Printf("started %d employee goroutines", len(employees))

	// Trigger CEO for any project already in_progress
	if projectIDs, err := database.GetInProgressProjectIDs(ctx); err != nil {
		log.Printf("warning: could not load in-progress projects: %v", err)
	} else {
		for _, pid := range projectIDs {
			if err := svc.StartProject(pid); err != nil {
				log.Printf("warning: could not trigger project %s: %v", pid, err)
			} else {
				log.Printf("triggered in-progress project %s", pid)
			}
		}
	}

	router := api.NewRouter(svc, msgBus)

	addr := ":" + cfg.Port
	log.Printf("Go Agent Engine listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
