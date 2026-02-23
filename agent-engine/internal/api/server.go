package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/engine"
)

// NewRouter creates the chi HTTP router for the Go engine
func NewRouter(scheduler *engine.Scheduler, msgBus *bus.Bus) http.Handler {
	r := chi.NewRouter()

	// Middleware
	r.Use(recoverer)
	r.Use(logger)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://127.0.0.1:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
	}))

	h := &engineHandler{
		scheduler: scheduler,
		bus:       msgBus,
	}

	r.Get("/engine/health", healthHandler)

	r.Route("/engine/projects/{id}", func(r chi.Router) {
		r.Post("/start", h.startProject)
		r.Post("/stop", h.stopProject)
		r.Get("/status", h.projectStatus)
		r.Post("/message", h.founderMessage)
		r.Get("/events", h.events)
	})

	return r
}
