package db

import "time"

// Company mirrors the Prisma Company model
type Company struct {
	ID          string    `db:"id"`
	Name        string    `db:"name"`
	Description *string   `db:"description"`
	CreatedAt   time.Time `db:"createdAt"`
	UpdatedAt   time.Time `db:"updatedAt"`
}

// AgentRole mirrors the Prisma AgentRole model
type AgentRole struct {
	ID           string    `db:"id"`
	Name         string    `db:"name"`
	Title        string    `db:"title"`
	SystemPrompt string    `db:"systemPrompt"`
	ModelConfig  string    `db:"modelConfig"` // JSON string
	Capabilities *string   `db:"capabilities"` // JSON string, nullable
	IsBuiltin    bool      `db:"isBuiltin"`
	CreatedAt    time.Time `db:"createdAt"`
	UpdatedAt    time.Time `db:"updatedAt"`
}

// Employee mirrors the Prisma Employee model
type Employee struct {
	ID        string    `db:"id"`
	CompanyID string    `db:"companyId"`
	RoleID    string    `db:"roleId"`
	Name      string    `db:"name"`
	Status    string    `db:"status"` // idle, busy, offline
	CreatedAt time.Time `db:"createdAt"`
	UpdatedAt time.Time `db:"updatedAt"`
}

// EmployeeWithRole is Employee joined with AgentRole
type EmployeeWithRole struct {
	Employee
	RoleName         string  `db:"role_name"`
	RoleTitle        string  `db:"role_title"`
	RoleSystemPrompt string  `db:"role_systemPrompt"`
	RoleModelConfig  string  `db:"role_modelConfig"`
}

// Project mirrors the Prisma Project model
type Project struct {
	ID          string    `db:"id"`
	CompanyID   string    `db:"companyId"`
	Name        string    `db:"name"`
	Description string    `db:"description"`
	Document    *string   `db:"document"`
	Status      string    `db:"status"` // planning, in_progress, review, completed, failed
	CreatedAt   time.Time `db:"createdAt"`
	UpdatedAt   time.Time `db:"updatedAt"`
}

// Task mirrors the Prisma Task model
type Task struct {
	ID          string    `db:"id"`
	ProjectID   string    `db:"projectId"`
	ParentID    *string   `db:"parentId"`
	Title       string    `db:"title"`
	Description string    `db:"description"`
	Status      string    `db:"status"` // pending, assigned, in_progress, review, completed, blocked
	Priority    int       `db:"priority"`
	Output      *string   `db:"output"`
	CreatedAt   time.Time `db:"createdAt"`
	UpdatedAt   time.Time `db:"updatedAt"`
}

// TaskAssignment mirrors the Prisma TaskAssignment model
type TaskAssignment struct {
	ID         string    `db:"id"`
	TaskID     string    `db:"taskId"`
	EmployeeID string    `db:"employeeId"`
	AssignedAt time.Time `db:"assignedAt"`
}

// TaskWithAssignment is Task joined with its first assignment
type TaskWithAssignment struct {
	Task
	AssigneeID    *string `db:"assignee_id"`
	AssigneeName  *string `db:"assignee_name"`
	AssigneeRole  *string `db:"assignee_role"`
	AssigneeTitle *string `db:"assignee_title"`
}

// Message mirrors the Prisma Message model
type Message struct {
	ID         string    `db:"id"`
	ProjectID  string    `db:"projectId"`
	TaskID     *string   `db:"taskId"`
	SenderID   *string   `db:"senderId"`
	SenderType string    `db:"senderType"` // founder, agent, system
	Content    string    `db:"content"`
	Metadata   *string   `db:"metadata"` // JSON string
	CreatedAt  time.Time `db:"createdAt"`
}

// ProjectFile mirrors the Prisma ProjectFile model
type ProjectFile struct {
	ID         string    `db:"id"`
	ProjectID  string    `db:"projectId"`
	EmployeeID string    `db:"employeeId"`
	TaskID     *string   `db:"taskId"`
	Title      string    `db:"title"`
	Path       *string   `db:"path"`
	Content    string    `db:"content"`
	Brief      *string   `db:"brief"`
	FileType   string    `db:"fileType"` // document | code
	CreatedAt  time.Time `db:"createdAt"`
}

// TokenUsage mirrors the Prisma TokenUsage model
type TokenUsage struct {
	ID           string    `db:"id"`
	EmployeeID   string    `db:"employeeId"`
	ProjectID    *string   `db:"projectId"`
	Model        string    `db:"model"`
	Provider     string    `db:"provider"`
	InputTokens  int       `db:"inputTokens"`
	OutputTokens int       `db:"outputTokens"`
	Cost         *float64  `db:"cost"`
	CreatedAt    time.Time `db:"createdAt"`
}
