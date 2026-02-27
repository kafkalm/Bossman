package db

import (
	"context"
	"fmt"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/cuid"
)

// GetProject retrieves a project by ID.
func (d *DB) GetProject(ctx context.Context, id string) (*Project, error) {
	var p Project
	err := d.GetContext(ctx, &p, `SELECT * FROM Project WHERE id = ?`, id)
	if err != nil {
		return nil, fmt.Errorf("GetProject %s: %w", id, err)
	}
	return &p, nil
}

// UpdateProjectStatus updates a project's status.
func (d *DB) UpdateProjectStatus(ctx context.Context, id, status string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Project SET status = ?, updatedAt = ? WHERE id = ?`,
		status, time.Now(), id,
	)
	return err
}

// UpdateProjectDocument saves the compiled project document
func (d *DB) UpdateProjectDocument(ctx context.Context, id, document string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Project SET document = ?, updatedAt = ? WHERE id = ?`,
		document, time.Now(), id,
	)
	return err
}

// GetProjectEmployees returns all employees in the same company as the project, with role info
func (d *DB) GetProjectEmployees(ctx context.Context, projectID string) ([]EmployeeWithRole, error) {
	const q = `
	SELECT
		e.id, e.companyId, e.roleId, e.name, e.status, e.createdAt, e.updatedAt,
		r.name  AS role_name,
		r.title AS role_title,
		r.systemPrompt AS role_systemPrompt,
		r.modelConfig  AS role_modelConfig
	FROM Employee e
	JOIN AgentRole r ON r.id = e.roleId
	WHERE e.companyId = (SELECT companyId FROM Project WHERE id = ?)
	`
	var emps []EmployeeWithRole
	if err := d.SelectContext(ctx, &emps, q, projectID); err != nil {
		return nil, fmt.Errorf("GetProjectEmployees: %w", err)
	}
	return emps, nil
}

// GetTasksForProject returns all tasks for a project with their first assignee info
func (d *DB) GetTasksForProject(ctx context.Context, projectID string) ([]TaskWithAssignment, error) {
	const q = `
	SELECT
		t.id, t.projectId, t.parentId, t.title, t.description, t.status, t.priority, t.output, t.createdAt, t.updatedAt,
		e.id    AS assignee_id,
		e.name  AS assignee_name,
		r.name  AS assignee_role,
		r.title AS assignee_title
	FROM Task t
	LEFT JOIN TaskAssignment ta ON ta.taskId = t.id
	LEFT JOIN Employee e ON e.id = ta.employeeId
	LEFT JOIN AgentRole r ON r.id = e.roleId
	WHERE t.projectId = ?
	ORDER BY t.createdAt ASC
	`
	var tasks []TaskWithAssignment
	if err := d.SelectContext(ctx, &tasks, q, projectID); err != nil {
		return nil, fmt.Errorf("GetTasksForProject: %w", err)
	}
	return tasks, nil
}

// CreateTask creates a new task and returns it.
func (d *DB) CreateTask(ctx context.Context, projectID, title, description string, priority int) (*Task, error) {
	now := time.Now()
	id := cuid.Generate()
	_, err := d.ExecContext(ctx,
		`INSERT INTO Task (id, projectId, title, description, status, priority, createdAt, updatedAt)
		 VALUES (?, ?, ?, ?, 'todo', ?, ?, ?)`,
		id, projectID, title, description, priority, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateTask: %w", err)
	}
	return &Task{
		ID:          id,
		ProjectID:   projectID,
		Title:       title,
		Description: description,
		Status:      "todo",
		Priority:    priority,
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

// AssignTask creates a TaskAssignment record linking task to employee
func (d *DB) AssignTask(ctx context.Context, taskID, employeeID string) error {
	id := cuid.Generate()
	now := time.Now()
	_, err := d.ExecContext(ctx,
		`INSERT OR IGNORE INTO TaskAssignment (id, taskId, employeeId, assignedAt)
		 VALUES (?, ?, ?, ?)`,
		id, taskID, employeeID, now,
	)
	return err
}

// ReassignTask replaces all existing assignees for a task with the new employee.
func (d *DB) ReassignTask(ctx context.Context, taskID, employeeID string) error {
	tx, err := d.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("ReassignTask begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM TaskAssignment WHERE taskId = ?`, taskID); err != nil {
		return fmt.Errorf("ReassignTask clear: %w", err)
	}
	id := cuid.Generate()
	now := time.Now()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO TaskAssignment (id, taskId, employeeId, assignedAt) VALUES (?, ?, ?, ?)`,
		id, taskID, employeeID, now,
	); err != nil {
		return fmt.Errorf("ReassignTask insert: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("ReassignTask commit: %w", err)
	}
	return nil
}

// UpdateTaskStatus updates a task's status
func (d *DB) UpdateTaskStatus(ctx context.Context, taskID, status string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Task SET status = ?, updatedAt = ? WHERE id = ?`,
		status, time.Now(), taskID,
	)
	return err
}

// UpdateTaskOutput sets the task output and status
func (d *DB) UpdateTaskOutput(ctx context.Context, taskID, status, output string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Task SET status = ?, output = ?, updatedAt = ? WHERE id = ?`,
		status, output, time.Now(), taskID,
	)
	return err
}

// SetTaskOutput updates only task output content.
func (d *DB) SetTaskOutput(ctx context.Context, taskID, output string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Task SET output = ?, updatedAt = ? WHERE id = ?`,
		output, time.Now(), taskID,
	)
	return err
}

// UpdateTaskDetails updates task title/description/priority.
func (d *DB) UpdateTaskDetails(ctx context.Context, taskID, title, description string, priority int) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Task SET title = ?, description = ?, priority = ?, updatedAt = ? WHERE id = ?`,
		title, description, priority, time.Now(), taskID,
	)
	return err
}

// ClearTaskOutput clears task output (status transition is handled separately).
func (d *DB) ClearTaskOutput(ctx context.Context, taskID string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Task SET output = NULL, updatedAt = ? WHERE id = ?`,
		time.Now(), taskID,
	)
	return err
}

// GetTask retrieves a single task with its first assignee
func (d *DB) GetTask(ctx context.Context, taskID string) (*TaskWithAssignment, error) {
	const q = `
	SELECT
		t.id, t.projectId, t.parentId, t.title, t.description, t.status, t.priority, t.output, t.createdAt, t.updatedAt,
		e.id    AS assignee_id,
		e.name  AS assignee_name,
		r.name  AS assignee_role,
		r.title AS assignee_title
	FROM Task t
	LEFT JOIN TaskAssignment ta ON ta.taskId = t.id
	LEFT JOIN Employee e ON e.id = ta.employeeId
	LEFT JOIN AgentRole r ON r.id = e.roleId
	WHERE t.id = ?
	LIMIT 1
	`
	var task TaskWithAssignment
	if err := d.GetContext(ctx, &task, q, taskID); err != nil {
		return nil, fmt.Errorf("GetTask %s: %w", taskID, err)
	}
	return &task, nil
}

// GetInProgressProjectIDs returns IDs of all active projects.
func (d *DB) GetInProgressProjectIDs(ctx context.Context) ([]string, error) {
	var ids []string
	if err := d.SelectContext(ctx, &ids, `SELECT id FROM Project WHERE status = 'active'`); err != nil {
		return nil, fmt.Errorf("GetInProgressProjectIDs: %w", err)
	}
	return ids, nil
}

// GetInProgressProjectIDsByCompany returns active project IDs for a company.
func (d *DB) GetInProgressProjectIDsByCompany(ctx context.Context, companyID string) ([]string, error) {
	var ids []string
	if err := d.SelectContext(ctx, &ids,
		`SELECT id FROM Project WHERE companyId = ? AND status = 'active' ORDER BY updatedAt ASC`,
		companyID); err != nil {
		return nil, fmt.Errorf("GetInProgressProjectIDsByCompany: %w", err)
	}
	return ids, nil
}

// GetTodoQueue returns queued tasks for an employee.
func (d *DB) GetTodoQueue(ctx context.Context, employeeID, projectID string) ([]Task, error) {
	const q = `
	SELECT t.*
	FROM Task t
	JOIN TaskAssignment ta ON ta.taskId = t.id
	JOIN Project p ON p.id = t.projectId
	WHERE ta.employeeId = ? AND t.projectId = ?
	  AND p.status = 'active'
	  AND t.status IN ('todo', 'in_progress')
	ORDER BY t.priority DESC, t.createdAt ASC
	LIMIT 1
	`
	var tasks []Task
	if err := d.SelectContext(ctx, &tasks, q, employeeID, projectID); err != nil {
		return nil, fmt.Errorf("GetTodoQueue: %w", err)
	}
	return tasks, nil
}

// GetNextTodoTask returns one runnable task for the employee.
// Returns (nil, "", sql.ErrNoRows) when the employee has no queued tasks.
func (d *DB) GetNextTodoTask(ctx context.Context, employeeID string) (*Task, string, error) {
	const q = `
	SELECT t.id, t.projectId, t.parentId, t.title, t.description, t.status, t.priority, t.output, t.createdAt, t.updatedAt
	FROM Task t
	JOIN TaskAssignment ta ON ta.taskId = t.id
	JOIN Project p ON p.id = t.projectId
	WHERE ta.employeeId = ? AND t.status IN ('todo', 'in_progress') AND p.status = 'active'
	ORDER BY t.priority DESC, t.createdAt ASC
	LIMIT 1
	`
	var t Task
	if err := d.GetContext(ctx, &t, q, employeeID); err != nil {
		return nil, "", err
	}
	return &t, t.ProjectID, nil
}
