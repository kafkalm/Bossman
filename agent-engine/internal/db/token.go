package db

import (
	"context"
	"fmt"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/cuid"
)

// RecordTokenUsage saves token usage to the database
func (d *DB) RecordTokenUsage(ctx context.Context, employeeID string, projectID *string, model, provider string, inputTokens, outputTokens int, cost *float64) error {
	id := cuid.Generate()
	now := time.Now()
	_, err := d.ExecContext(ctx,
		`INSERT INTO TokenUsage (id, employeeId, projectId, model, provider, inputTokens, outputTokens, cost, createdAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, employeeID, projectID, model, provider, inputTokens, outputTokens, cost, now,
	)
	if err != nil {
		return fmt.Errorf("RecordTokenUsage: %w", err)
	}
	return nil
}
