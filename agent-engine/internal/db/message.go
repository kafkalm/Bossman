package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/cuid"
)

// CreateMessage persists a message to the database
func (d *DB) CreateMessage(ctx context.Context, projectID string, taskID *string, senderID *string, senderType, content string, metadata map[string]interface{}) (*Message, error) {
	id := cuid.Generate()
	now := time.Now()

	var metaStr *string
	if metadata != nil {
		b, err := json.Marshal(metadata)
		if err == nil {
			s := string(b)
			metaStr = &s
		}
	}

	_, err := d.ExecContext(ctx,
		`INSERT INTO Message (id, projectId, taskId, senderId, senderType, content, metadata, createdAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, projectID, taskID, senderID, senderType, content, metaStr, now,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateMessage: %w", err)
	}
	return &Message{
		ID:         id,
		ProjectID:  projectID,
		TaskID:     taskID,
		SenderID:   senderID,
		SenderType: senderType,
		Content:    content,
		Metadata:   metaStr,
		CreatedAt:  now,
	}, nil
}

// GetProjectMessages returns the most recent messages for a project (no taskId filter)
func (d *DB) GetProjectMessages(ctx context.Context, projectID string, limit int) ([]Message, error) {
	const q = `
	SELECT id, projectId, taskId, senderId, senderType, content, metadata, createdAt
	FROM Message
	WHERE projectId = ? AND taskId IS NULL
	ORDER BY createdAt ASC
	LIMIT ?
	`
	var msgs []Message
	if err := d.SelectContext(ctx, &msgs, q, projectID, limit); err != nil {
		return nil, fmt.Errorf("GetProjectMessages: %w", err)
	}
	return msgs, nil
}

// GetTaskMessages returns all messages for a specific task
func (d *DB) GetTaskMessages(ctx context.Context, taskID string) ([]Message, error) {
	const q = `
	SELECT id, projectId, taskId, senderId, senderType, content, metadata, createdAt
	FROM Message
	WHERE taskId = ?
	ORDER BY createdAt ASC
	`
	var msgs []Message
	if err := d.SelectContext(ctx, &msgs, q, taskID); err != nil {
		return nil, fmt.Errorf("GetTaskMessages: %w", err)
	}
	return msgs, nil
}

// GetRecentProjectMessages returns the N most recent project-level messages
func (d *DB) GetRecentProjectMessages(ctx context.Context, projectID string, limit int) ([]Message, error) {
	const q = `
	SELECT id, projectId, taskId, senderId, senderType, content, metadata, createdAt
	FROM Message
	WHERE projectId = ?
	ORDER BY createdAt DESC
	LIMIT ?
	`
	var msgs []Message
	if err := d.SelectContext(ctx, &msgs, q, projectID, limit); err != nil {
		return nil, fmt.Errorf("GetRecentProjectMessages: %w", err)
	}
	// Reverse to get chronological order
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs, nil
}

// GetSenderName returns employee name+title for a sender ID (used in message display)
func (d *DB) GetSenderName(ctx context.Context, senderID string) (name, title string, err error) {
	const q = `
	SELECT e.name, r.title
	FROM Employee e
	JOIN AgentRole r ON r.id = e.roleId
	WHERE e.id = ?
	`
	var row struct {
		Name  string `db:"name"`
		Title string `db:"title"`
	}
	if err := d.GetContext(ctx, &row, q, senderID); err != nil {
		return "", "", err
	}
	return row.Name, row.Title, nil
}
