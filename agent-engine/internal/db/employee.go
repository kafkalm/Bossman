package db

import (
	"context"
	"fmt"
	"strings"
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

// GetAllEmployeesWithRoles returns all employees with their role info
func (d *DB) GetAllEmployeesWithRoles(ctx context.Context) ([]EmployeeWithRole, error) {
	const q = `
	SELECT
		e.id, e.companyId, e.roleId, e.name, e.status, e.createdAt, e.updatedAt,
		r.name  AS role_name,
		r.title AS role_title,
		r.systemPrompt AS role_systemPrompt,
		r.modelConfig  AS role_modelConfig
	FROM Employee e
	JOIN AgentRole r ON r.id = e.roleId
	ORDER BY e.companyId, e.id
	`
	var emps []EmployeeWithRole
	if err := d.SelectContext(ctx, &emps, q); err != nil {
		return nil, fmt.Errorf("GetAllEmployeesWithRoles: %w", err)
	}
	return emps, nil
}

// GetProjectEmployeeByRole returns one employee in the project's company by role name.
func (d *DB) GetProjectEmployeeByRole(ctx context.Context, projectID, roleName string) (*EmployeeWithRole, error) {
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
	  AND r.name = ?
	ORDER BY e.createdAt ASC
	LIMIT 1
	`
	var emp EmployeeWithRole
	if err := d.GetContext(ctx, &emp, q, projectID, roleName); err != nil {
		return nil, fmt.Errorf("GetProjectEmployeeByRole: %w", err)
	}
	return &emp, nil
}

// GetEffectiveSkills returns union of employee-bound and role-bound skills.
func (d *DB) GetEffectiveSkills(ctx context.Context, employeeID, roleID string) ([]Skill, error) {
	const q = `
	SELECT DISTINCT
		s.id, s.name, s.description, s.content, s.source, s.companyId, s.createdAt, s.updatedAt
	FROM Skill s
	LEFT JOIN EmployeeSkill es ON es.skillId = s.id
	LEFT JOIN AgentRoleSkill ars ON ars.skillId = s.id
	WHERE es.employeeId = ? OR ars.roleId = ?
	ORDER BY s.name ASC
	`
	var skills []Skill
	if err := d.SelectContext(ctx, &skills, q, employeeID, roleID); err != nil {
		// Backward compatibility for old local test/dev DBs without skills tables.
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "no such table") {
			return nil, nil
		}
		return nil, fmt.Errorf("GetEffectiveSkills: %w", err)
	}
	return skills, nil
}
