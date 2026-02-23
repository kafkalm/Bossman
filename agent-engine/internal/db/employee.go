package db

import (
	"context"
	"fmt"
	"time"
)

// GetEmployee returns an employee with their role
func (d *DB) GetEmployee(ctx context.Context, id string) (*EmployeeWithRole, error) {
	const q = `
	SELECT
		e.id, e.companyId, e.roleId, e.name, e.status, e.createdAt, e.updatedAt,
		r.name  AS role_name,
		r.title AS role_title,
		r.systemPrompt AS role_systemPrompt,
		r.modelConfig  AS role_modelConfig
	FROM Employee e
	JOIN AgentRole r ON r.id = e.roleId
	WHERE e.id = ?
	`
	var emp EmployeeWithRole
	if err := d.GetContext(ctx, &emp, q, id); err != nil {
		return nil, fmt.Errorf("GetEmployee %s: %w", id, err)
	}
	return &emp, nil
}

// SetEmployeeStatus updates the status of an employee
func (d *DB) SetEmployeeStatus(ctx context.Context, id, status string) error {
	_, err := d.ExecContext(ctx,
		`UPDATE Employee SET status = ?, updatedAt = ? WHERE id = ?`,
		status, time.Now(), id,
	)
	return err
}
