package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/engine"
)

// Pool is the engine interface used by the API (start/stop project, founder message, status)
type Pool interface {
	StartProject(projectID string) error
	StopProject(projectID string)
	IsRunning(projectID string) bool
	SendFounderMessage(projectID, message string) error
	SnapshotProject(projectID string) (*engine.ProjectSnapshot, error)
	GetTimeline(projectID string, taskID *string, limit int) ([]db.TimelineEvent, error)
	GetTimelinePage(projectID string, taskID *string, limit int, cursor string, direction string) (*engine.TimelinePage, error)
	CommandProject(projectID, action string, payload map[string]interface{}) error
}

// NewRouter creates the chi HTTP router for the Go engine.
func NewRouter(pool Pool, msgBus *bus.Bus) http.Handler {
	r := chi.NewRouter()

	r.Use(recoverer)
	r.Use(logger)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://127.0.0.1:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
	}))

	h := &engineHandler{pool: pool, bus: msgBus}

	r.Get("/engine/health", healthHandler)
	r.Route("/engine/projects/{id}", func(r chi.Router) {
		r.Post("/command", h.commandProject)
		r.Get("/timeline", h.projectTimeline)
		r.Post("/start", h.startProject)
		r.Post("/pause", h.pauseProject)
		r.Post("/stop", h.stopProject)
		r.Get("/status", h.projectStatus)
		r.Get("/snapshot", h.projectSnapshot)
		r.Post("/message", h.founderMessage)
		r.Get("/events", h.events)
	})

	return r
}
