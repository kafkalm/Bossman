package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
)

const (
	eventRefresh = "refresh"
	eventPing    = "ping"

	busTypeDeliverable  = "deliverable"
	busTypeStatusUpdate = "status_update"
)

type engineHandler struct {
	pool Pool
	bus  *bus.Bus
}

// POST /engine/projects/:id/start
func (h *engineHandler) startProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	if err := h.pool.StartProject(projectID); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "status": "started"})
}

// POST /engine/projects/:id/stop
func (h *engineHandler) stopProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	h.pool.StopProject(projectID)
	jsonOK(w, map[string]interface{}{"ok": true})
}

// GET /engine/projects/:id/status
func (h *engineHandler) projectStatus(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	running := h.pool.IsRunning(projectID)
	jsonOK(w, map[string]interface{}{"running": running})
}

// GET /engine/projects/:id/snapshot
func (h *engineHandler) projectSnapshot(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	snapshot, err := h.pool.SnapshotProject(projectID)
	if err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}
	jsonOK(w, snapshot)
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
	if err := h.pool.SendFounderMessage(projectID, body.Content); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "status": "sent"})
}

// GET /engine/projects/:id/events — SSE stream
func (h *engineHandler) events(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")

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
			if msg.MessageType == busTypeDeliverable || msg.MessageType == busTypeStatusUpdate {
				send(eventRefresh, map[string]interface{}{"type": msg.MessageType})
			}
		case <-ticker.C:
			send(eventPing, nil)
		}
	}
}

// GET /engine/health
func healthHandler(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{"ok": true, "service": "agent-engine"})
}
