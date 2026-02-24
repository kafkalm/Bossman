package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/kafkalm/bossman/agent-engine/internal/cuid"
)

func (d *DB) EnsureRuntimeTables(ctx context.Context) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS project_transitions (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, fromStatus TEXT NOT NULL, toStatus TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS task_transitions (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, projectId TEXT NOT NULL, fromStatus TEXT NOT NULL, toStatus TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS conversation_threads (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, taskId TEXT, subject TEXT NOT NULL, createdBy TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS conversation_messages (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, projectId TEXT NOT NULL, taskId TEXT, fromEmployeeId TEXT, toEmployeeId TEXT, messageType TEXT NOT NULL, content TEXT NOT NULL, payload TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS employee_inbox (id TEXT PRIMARY KEY, employeeId TEXT NOT NULL, projectId TEXT NOT NULL, taskId TEXT, threadId TEXT, messageId TEXT, status TEXT NOT NULL DEFAULT 'pending', expiresAt DATETIME, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS engine_timeline_events (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, taskId TEXT, eventType TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL, payload TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE INDEX IF NOT EXISTS project_transitions_projectId_createdAt_idx ON project_transitions(projectId, createdAt)`,
		`CREATE INDEX IF NOT EXISTS task_transitions_projectId_createdAt_idx ON task_transitions(projectId, createdAt)`,
		`CREATE INDEX IF NOT EXISTS employee_inbox_employeeId_projectId_status_idx ON employee_inbox(employeeId, projectId, status)`,
		`CREATE INDEX IF NOT EXISTS engine_timeline_events_projectId_createdAt_idx ON engine_timeline_events(projectId, createdAt)`,
	}
	for _, q := range queries {
		if _, err := d.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("EnsureRuntimeTables: %w", err)
		}
	}
	return nil
}

// NormalizeLegacyStatuses maps legacy status values to the v2 status model.
func (d *DB) NormalizeLegacyStatuses(ctx context.Context) error {
	queries := []string{
		`UPDATE Project SET status = 'active' WHERE status IN ('planning', 'in_progress')`,
		`UPDATE Project SET status = 'done' WHERE status = 'completed'`,
		`UPDATE Project SET status = 'blocked' WHERE status = 'failed'`,
		`UPDATE Project SET status = 'canceled' WHERE status IN ('cancelled')`,
		`UPDATE Project SET status = 'blocked' WHERE status NOT IN ('active', 'review', 'paused', 'done', 'blocked', 'canceled')`,
		`UPDATE Task SET status = 'todo' WHERE status IN ('created', 'ready', 'pending', 'assigned')`,
		`UPDATE Task SET status = 'done' WHERE status = 'completed'`,
		`UPDATE Task SET status = 'canceled' WHERE status IN ('cancelled')`,
		`UPDATE Task SET status = 'blocked' WHERE status NOT IN ('todo', 'in_progress', 'review', 'done', 'blocked', 'canceled')`,
	}
	for _, q := range queries {
		if _, err := d.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("NormalizeLegacyStatuses: %w", err)
		}
	}
	if err := d.backfillTransitionBaselines(ctx); err != nil {
		return err
	}
	return nil
}

func (d *DB) backfillTransitionBaselines(ctx context.Context) error {
	now := time.Now()
	var projects []struct {
		ID     string `db:"id"`
		Status string `db:"status"`
	}
	if err := d.SelectContext(ctx, &projects, `SELECT id, status FROM Project`); err != nil {
		return fmt.Errorf("backfill project baselines load: %w", err)
	}
	for _, p := range projects {
		var count int
		if err := d.GetContext(ctx, &count, `SELECT COUNT(*) FROM project_transitions WHERE projectId = ?`, p.ID); err != nil {
			return fmt.Errorf("backfill project baselines count: %w", err)
		}
		if count > 0 {
			continue
		}
		if _, err := d.ExecContext(ctx,
			`INSERT INTO project_transitions (id, projectId, fromStatus, toStatus, reason, actor, createdAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			cuid.Generate(), p.ID, p.Status, p.Status, "migration baseline", "migration", now); err != nil {
			return fmt.Errorf("backfill project baseline insert: %w", err)
		}
	}

	var tasks []struct {
		ID        string `db:"id"`
		ProjectID string `db:"projectId"`
		Status    string `db:"status"`
	}
	if err := d.SelectContext(ctx, &tasks, `SELECT id, projectId, status FROM Task`); err != nil {
		return fmt.Errorf("backfill task baselines load: %w", err)
	}
	for _, t := range tasks {
		var count int
		if err := d.GetContext(ctx, &count, `SELECT COUNT(*) FROM task_transitions WHERE taskId = ?`, t.ID); err != nil {
			return fmt.Errorf("backfill task baselines count: %w", err)
		}
		if count > 0 {
			continue
		}
		if _, err := d.ExecContext(ctx,
			`INSERT INTO task_transitions (id, taskId, projectId, fromStatus, toStatus, reason, actor, createdAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			cuid.Generate(), t.ID, t.ProjectID, t.Status, t.Status, "migration baseline", "migration", now); err != nil {
			return fmt.Errorf("backfill task baseline insert: %w", err)
		}
	}
	return nil
}

func (d *DB) TransitionProjectStatus(ctx context.Context, projectID, to, reason, actor string) (string, error) {
	tx, err := d.BeginTxx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()

	var from string
	if err := tx.GetContext(ctx, &from, `SELECT status FROM Project WHERE id = ?`, projectID); err != nil {
		return "", fmt.Errorf("TransitionProjectStatus load: %w", err)
	}

	now := time.Now()
	if _, err := tx.ExecContext(ctx,
		`UPDATE Project SET status = ?, updatedAt = ? WHERE id = ?`,
		to, now, projectID,
	); err != nil {
		return "", fmt.Errorf("TransitionProjectStatus update: %w", err)
	}

	if err := d.insertProjectTransitionTx(ctx, tx, projectID, from, to, reason, actor, now); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return from, nil
}

func (d *DB) TransitionTaskStatus(ctx context.Context, taskID, to, reason, actor string) (from string, projectID string, err error) {
	tx, err := d.BeginTxx(ctx, nil)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback() }()

	var row struct {
		Status    string `db:"status"`
		ProjectID string `db:"projectId"`
	}
	if err := tx.GetContext(ctx, &row, `SELECT status, projectId FROM Task WHERE id = ?`, taskID); err != nil {
		return "", "", fmt.Errorf("TransitionTaskStatus load: %w", err)
	}

	now := time.Now()
	if _, err := tx.ExecContext(ctx,
		`UPDATE Task SET status = ?, updatedAt = ? WHERE id = ?`,
		to, now, taskID,
	); err != nil {
		return "", "", fmt.Errorf("TransitionTaskStatus update: %w", err)
	}

	if err := d.insertTaskTransitionTx(ctx, tx, taskID, row.ProjectID, row.Status, to, reason, actor, now); err != nil {
		return "", "", err
	}
	if err := tx.Commit(); err != nil {
		return "", "", err
	}
	return row.Status, row.ProjectID, nil
}

func (d *DB) insertProjectTransitionTx(ctx context.Context, tx *sqlx.Tx, projectID, from, to, reason, actor string, now time.Time) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO project_transitions (id, projectId, fromStatus, toStatus, reason, actor, createdAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		cuid.Generate(), projectID, from, to, reason, actor, now,
	)
	if err != nil {
		return fmt.Errorf("insert project transition: %w", err)
	}
	return nil
}

func (d *DB) insertTaskTransitionTx(ctx context.Context, tx *sqlx.Tx, taskID, projectID, from, to, reason, actor string, now time.Time) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO task_transitions (id, taskId, projectId, fromStatus, toStatus, reason, actor, createdAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		cuid.Generate(), taskID, projectID, from, to, reason, actor, now,
	)
	if err != nil {
		return fmt.Errorf("insert task transition: %w", err)
	}
	return nil
}

func (d *DB) AddTimelineEvent(ctx context.Context, projectID string, taskID *string, eventType, actor, summary string, payload map[string]interface{}) error {
	now := time.Now()
	var payloadStr *string
	if payload != nil {
		b, err := json.Marshal(payload)
		if err == nil {
			s := string(b)
			payloadStr = &s
		}
	}
	_, err := d.ExecContext(ctx,
		`INSERT INTO engine_timeline_events (id, projectId, taskId, eventType, actor, summary, payload, createdAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		cuid.Generate(), projectID, taskID, eventType, actor, summary, payloadStr, now,
	)
	if err != nil {
		return fmt.Errorf("AddTimelineEvent: %w", err)
	}
	return nil
}

func (d *DB) GetTimelineEvents(ctx context.Context, projectID string, taskID *string, limit int) ([]TimelineEvent, error) {
	events, err := d.GetTimelineEventsWithCursor(ctx, projectID, taskID, limit, "", time.Time{}, false, "older")
	return events, err
}

// GetTimelineEventsWithCursor returns timeline events ordered by createdAt desc and id desc.
// If cursorCreatedAt/cursorID are provided, it returns records older/newer than that anchor.
func (d *DB) GetTimelineEventsWithCursor(
	ctx context.Context,
	projectID string,
	taskID *string,
	limit int,
	cursorID string,
	cursorCreatedAt time.Time,
	hasCursor bool,
	direction string,
) ([]TimelineEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	var events []TimelineEvent
	if direction != "newer" {
		direction = "older"
	}

	baseQuery := `SELECT id, projectId, taskId, eventType, actor, summary, payload, createdAt
		 FROM engine_timeline_events
		 WHERE projectId = ?`
	args := []interface{}{projectID}
	if taskID != nil && *taskID != "" {
		baseQuery += ` AND taskId = ?`
		args = append(args, *taskID)
	}
	if hasCursor {
		if direction == "newer" {
			baseQuery += ` AND (createdAt > ? OR (createdAt = ? AND id > ?))`
			args = append(args, cursorCreatedAt, cursorCreatedAt, cursorID)
		} else {
			baseQuery += ` AND (createdAt < ? OR (createdAt = ? AND id < ?))`
			args = append(args, cursorCreatedAt, cursorCreatedAt, cursorID)
		}
	}
	if direction == "newer" {
		baseQuery += ` ORDER BY createdAt ASC, id ASC LIMIT ?`
	} else {
		baseQuery += ` ORDER BY createdAt DESC, id DESC LIMIT ?`
	}
	args = append(args, limit)

	if err := d.SelectContext(ctx, &events, baseQuery, args...); err != nil {
		return nil, fmt.Errorf("GetTimelineEventsWithCursor: %w", err)
	}
	return events, nil
}

func (d *DB) GetRecentProjectTransitions(ctx context.Context, projectID string, limit int) ([]ProjectTransition, error) {
	if limit <= 0 {
		limit = 10
	}
	var items []ProjectTransition
	if err := d.SelectContext(ctx, &items,
		`SELECT id, projectId, fromStatus, toStatus, reason, actor, createdAt
		 FROM project_transitions WHERE projectId = ?
		 ORDER BY createdAt DESC LIMIT ?`,
		projectID, limit); err != nil {
		return nil, fmt.Errorf("GetRecentProjectTransitions: %w", err)
	}
	return items, nil
}

func (d *DB) GetRecentTaskTransitions(ctx context.Context, projectID string, limit int) ([]TaskTransition, error) {
	if limit <= 0 {
		limit = 20
	}
	var items []TaskTransition
	if err := d.SelectContext(ctx, &items,
		`SELECT id, taskId, projectId, fromStatus, toStatus, reason, actor, createdAt
		 FROM task_transitions WHERE projectId = ?
		 ORDER BY createdAt DESC LIMIT ?`,
		projectID, limit); err != nil {
		return nil, fmt.Errorf("GetRecentTaskTransitions: %w", err)
	}
	return items, nil
}

func (d *DB) CountPendingInboxByProject(ctx context.Context, projectID string) (int, error) {
	var n int
	if err := d.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM employee_inbox WHERE projectId = ? AND status = 'pending'`,
		projectID); err != nil {
		return 0, fmt.Errorf("CountPendingInboxByProject: %w", err)
	}
	return n, nil
}

func (d *DB) ExpireInbox(ctx context.Context, now time.Time) error {
	_, err := d.ExecContext(ctx,
		`UPDATE employee_inbox
		 SET status = 'expired', updatedAt = ?
		 WHERE status = 'pending' AND expiresAt IS NOT NULL AND expiresAt < ?`,
		now, now)
	if err != nil {
		return fmt.Errorf("ExpireInbox: %w", err)
	}
	return nil
}

func (d *DB) CreateConversationThread(ctx context.Context, projectID string, taskID *string, subject, createdBy string) (*ConversationThread, error) {
	now := time.Now()
	thread := &ConversationThread{
		ID:        cuid.Generate(),
		ProjectID: projectID,
		TaskID:    taskID,
		Subject:   subject,
		CreatedBy: createdBy,
		Status:    "open",
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := d.ExecContext(ctx,
		`INSERT INTO conversation_threads (id, projectId, taskId, subject, createdBy, status, createdAt, updatedAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		thread.ID, thread.ProjectID, thread.TaskID, thread.Subject, thread.CreatedBy, thread.Status, thread.CreatedAt, thread.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateConversationThread: %w", err)
	}
	return thread, nil
}

func (d *DB) CreateConversationMessage(ctx context.Context, threadID, projectID string, taskID *string, fromEmployeeID, toEmployeeID *string, messageType, content string, payload map[string]interface{}) (*ConversationMessage, error) {
	now := time.Now()
	msg := &ConversationMessage{
		ID:             cuid.Generate(),
		ThreadID:       threadID,
		ProjectID:      projectID,
		TaskID:         taskID,
		FromEmployeeID: fromEmployeeID,
		ToEmployeeID:   toEmployeeID,
		MessageType:    messageType,
		Content:        content,
		CreatedAt:      now,
	}
	if payload != nil {
		b, err := json.Marshal(payload)
		if err == nil {
			s := string(b)
			msg.Payload = &s
		}
	}

	_, err := d.ExecContext(ctx,
		`INSERT INTO conversation_messages (id, threadId, projectId, taskId, fromEmployeeId, toEmployeeId, messageType, content, payload, createdAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		msg.ID, msg.ThreadID, msg.ProjectID, msg.TaskID, msg.FromEmployeeID, msg.ToEmployeeID, msg.MessageType, msg.Content, msg.Payload, msg.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateConversationMessage: %w", err)
	}
	return msg, nil
}

func (d *DB) CreateInboxItem(ctx context.Context, employeeID, projectID string, taskID, threadID, messageID *string, ttl time.Duration) (*EmployeeInbox, error) {
	now := time.Now()
	item := &EmployeeInbox{
		ID:         cuid.Generate(),
		EmployeeID: employeeID,
		ProjectID:  projectID,
		TaskID:     taskID,
		ThreadID:   threadID,
		MessageID:  messageID,
		Status:     "pending",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if ttl > 0 {
		expires := now.Add(ttl)
		item.ExpiresAt = &expires
	}
	_, err := d.ExecContext(ctx,
		`INSERT INTO employee_inbox (id, employeeId, projectId, taskId, threadId, messageId, status, expiresAt, createdAt, updatedAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.EmployeeID, item.ProjectID, item.TaskID, item.ThreadID, item.MessageID, item.Status, item.ExpiresAt, item.CreatedAt, item.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateInboxItem: %w", err)
	}
	return item, nil
}

func (d *DB) GetPendingInboxItems(ctx context.Context, employeeID, projectID string, limit int) ([]InboxItem, error) {
	if limit <= 0 {
		limit = 20
	}
	const q = `
	SELECT
		i.id, i.employeeId, i.projectId, i.taskId, i.threadId, i.messageId, i.status, i.expiresAt, i.createdAt, i.updatedAt,
		m.content,
		m.messageType,
		m.fromEmployeeId,
		m.toEmployeeId,
		t.subject as thread_subject
	FROM employee_inbox i
	LEFT JOIN conversation_messages m ON m.id = i.messageId
	LEFT JOIN conversation_threads t ON t.id = i.threadId
	WHERE i.employeeId = ? AND i.projectId = ? AND i.status = 'pending'
	ORDER BY i.createdAt ASC
	LIMIT ?
	`
	var rows []InboxItem
	if err := d.SelectContext(ctx, &rows, q, employeeID, projectID, limit); err != nil {
		return nil, fmt.Errorf("GetPendingInboxItems: %w", err)
	}
	return rows, nil
}

func (d *DB) AckInboxItem(ctx context.Context, inboxID, result string) error {
	status := strings.TrimSpace(result)
	if status == "" {
		status = "done"
	}
	now := time.Now()
	_, err := d.ExecContext(ctx,
		`UPDATE employee_inbox SET status = ?, updatedAt = ? WHERE id = ?`,
		status, now, inboxID,
	)
	if err != nil {
		return fmt.Errorf("AckInboxItem: %w", err)
	}
	return nil
}

func (d *DB) GetInboxItem(ctx context.Context, inboxID string) (*EmployeeInbox, error) {
	var item EmployeeInbox
	if err := d.GetContext(ctx, &item,
		`SELECT id, employeeId, projectId, taskId, threadId, messageId, status, expiresAt, createdAt, updatedAt
		 FROM employee_inbox WHERE id = ?`,
		inboxID); err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("GetInboxItem: %w", err)
	}
	return &item, nil
}
