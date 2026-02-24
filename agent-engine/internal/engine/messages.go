package engine

import (
	"context"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

// sendSystemMsg persists a system message and publishes to bus.
func sendSystemMsg(ctx context.Context, database *db.DB, msgBus BusPublisher, projectID string, taskID *string, content string, metadata ...map[string]interface{}) error {
	var meta map[string]interface{}
	if len(metadata) > 0 {
		meta = metadata[0]
	}
	msg, err := database.CreateMessage(ctx, projectID, taskID, nil, "system", content, meta)
	if err != nil {
		return err
	}
	messageType := EngineEventProjectUpdated
	if taskID != nil {
		messageType = EngineEventTaskUpdated
	}
	msgBus.Publish(bus.BusMessage{
		ID:          msg.ID,
		ProjectID:   projectID,
		TaskID:      taskID,
		SenderType:  "system",
		MessageType: messageType,
		Content:     content,
		Metadata:    meta,
		CreatedAt:   msg.CreatedAt,
	})
	return nil
}

// sendAgentMsg persists an agent message and publishes to bus.
func sendAgentMsg(ctx context.Context, database *db.DB, msgBus BusPublisher, projectID string, taskID *string, senderID *string, content string, metadata map[string]interface{}) error {
	msg, err := database.CreateMessage(ctx, projectID, taskID, senderID, "agent", content, metadata)
	if err != nil {
		return err
	}
	msgBus.Publish(bus.BusMessage{
		ID:          msg.ID,
		ProjectID:   projectID,
		TaskID:      taskID,
		SenderID:    senderID,
		SenderType:  "agent",
		MessageType: EngineEventTaskUpdated,
		Content:     content,
		Metadata:    metadata,
		CreatedAt:   msg.CreatedAt,
	})
	return nil
}
