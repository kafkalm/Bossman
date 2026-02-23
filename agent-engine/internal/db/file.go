package db

import (
	"context"
	"fmt"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/cuid"
)

// CreateProjectFile inserts a new ProjectFile record
func (d *DB) CreateProjectFile(ctx context.Context, projectID, employeeID string, taskID *string, title string, pathDir *string, content, brief, fileType string) (*ProjectFile, error) {
	id := cuid.Generate()
	now := time.Now()
	_, err := d.ExecContext(ctx,
		`INSERT INTO ProjectFile (id, projectId, employeeId, taskId, title, path, content, brief, fileType, createdAt)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, projectID, employeeID, taskID, title, pathDir, content, brief, fileType, now,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateProjectFile: %w", err)
	}
	return &ProjectFile{
		ID:         id,
		ProjectID:  projectID,
		EmployeeID: employeeID,
		TaskID:     taskID,
		Title:      title,
		Path:       pathDir,
		Content:    content,
		Brief:      &brief,
		FileType:   fileType,
		CreatedAt:  now,
	}, nil
}
