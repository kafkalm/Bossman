package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/engine"
)

type engineHandler struct {
	scheduler *engine.Scheduler
	bus       *bus.Bus
}

// POST /engine/projects/:id/start
func (h *engineHandler) startProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	if err := h.scheduler.StartProject(projectID); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "status": "started"})
}

// POST /engine/projects/:id/stop
func (h *engineHandler) stopProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	h.scheduler.StopProject(projectID)
	jsonOK(w, map[string]interface{}{"ok": true})
}

// GET /engine/projects/:id/status
func (h *engineHandler) projectStatus(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	running := h.scheduler.IsRunning(projectID)
	jsonOK(w, map[string]interface{}{"running": running})
}

// POST /engine/projects/:id/message
func (h *engineHandler) founderMessage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		jsonError(w, http.StatusBadRequest, "content is required")
		return
	}

	if err := h.scheduler.SendFounderMessage(projectID, body.Content); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "status": "sent"})
}

// GET /engine/projects/:id/events — SSE stream
func (h *engineHandler) events(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

	// SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return
	}

	msgCh, unsub := h.bus.Subscribe(projectID)
	defer unsub()

	// Keep-alive ticker
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	send := func(event string, data map[string]interface{}) {
		if data == nil {
			data = map[string]interface{}{}
		}
		b, _ := json.Marshal(data)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return

		case msg, open := <-msgCh:
			if !open {
				return
			}
			if msg.MessageType == "deliverable" || msg.MessageType == "status_update" {
				send("refresh", map[string]interface{}{"type": msg.MessageType})
			}

		case <-ticker.C:
			send("ping", nil)
		}
	}
}

// GET /engine/health
func healthHandler(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{"ok": true, "service": "agent-engine"})
}
