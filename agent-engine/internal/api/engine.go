package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kafkalm/bossman/agent-engine/internal/bus"
)

const (
	eventPing = "ping"
)

type engineHandler struct {
	pool Pool
	bus  *bus.Bus
}

// POST /engine/projects/:id/start
func (h *engineHandler) startProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	if err := h.pool.CommandProject(projectID, "start", nil); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "status": "started"})
}

// POST /engine/projects/:id/stop
func (h *engineHandler) stopProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	_ = h.pool.CommandProject(projectID, "stop", nil)
	jsonOK(w, map[string]interface{}{"ok": true})
}

// POST /engine/projects/:id/pause
func (h *engineHandler) pauseProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	if err := h.pool.CommandProject(projectID, "pause", nil); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "status": "paused"})
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
	if err := h.pool.CommandProject(projectID, "send_founder_message", map[string]interface{}{"content": body.Content}); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "status": "sent"})
}

// POST /engine/projects/:id/command
func (h *engineHandler) commandProject(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	var body struct {
		Action  string                 `json:"action"`
		Payload map[string]interface{} `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Action == "" {
		jsonError(w, http.StatusBadRequest, "action is required")
		return
	}
	if body.Payload == nil {
		body.Payload = map[string]interface{}{}
	}
	if err := h.pool.CommandProject(projectID, body.Action, body.Payload); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{"ok": true, "action": body.Action})
}

// GET /engine/projects/:id/timeline
func (h *engineHandler) projectTimeline(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	taskID := r.URL.Query().Get("task_id")
	cursor := r.URL.Query().Get("cursor")
	direction := r.URL.Query().Get("direction")
	if direction != "newer" {
		direction = "older"
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	var taskIDPtr *string
	if taskID != "" {
		taskIDPtr = &taskID
	}
	page, err := h.pool.GetTimelinePage(projectID, taskIDPtr, limit, cursor, direction)
	if err != nil {
		jsonError(w, http.StatusNotFound, err.Error())
		return
	}
	jsonOK(w, map[string]interface{}{
		"events":     page.Events,
		"nextCursor": page.NextCursor,
	})
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
			payload := map[string]interface{}{
				"id":         msg.ID,
				"projectId":  msg.ProjectID,
				"taskId":     msg.TaskID,
				"senderId":   msg.SenderID,
				"senderType": msg.SenderType,
				"type":       msg.MessageType,
				"eventType":  msg.MessageType,
				"content":    msg.Content,
				"summary":    msg.Content,
				"metadata":   msg.Metadata,
				"createdAt":  msg.CreatedAt,
			}
			send(msg.MessageType, payload)
		case <-ticker.C:
			send(eventPing, nil)
		}
	}
}

// GET /engine/health
func healthHandler(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{"ok": true, "service": "agent-engine"})
}
