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

// Skill mirrors the Prisma Skill model.
type Skill struct {
	ID          string    `db:"id"`
	Name        string    `db:"name"`
	Description *string   `db:"description"`
	Content     string    `db:"content"`
	Source      string    `db:"source"`
	CompanyID   *string   `db:"companyId"`
	CreatedAt   time.Time `db:"createdAt"`
	UpdatedAt   time.Time `db:"updatedAt"`
}

// AgentRole mirrors the Prisma AgentRole model
type AgentRole struct {
	ID           string    `db:"id"`
	Name         string    `db:"name"`
	Title        string    `db:"title"`
	SystemPrompt string    `db:"systemPrompt"`
	ModelConfig  string    `db:"modelConfig"`  // JSON string
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
	RoleName         string `db:"role_name"`
	RoleTitle        string `db:"role_title"`
	RoleSystemPrompt string `db:"role_systemPrompt"`
	RoleModelConfig  string `db:"role_modelConfig"`
}

// Project mirrors the Prisma Project model
type Project struct {
	ID          string    `db:"id"`
	CompanyID   string    `db:"companyId"`
	Name        string    `db:"name"`
	Description string    `db:"description"`
	Document    *string   `db:"document"`
	Status      string    `db:"status"` // active, review, paused, done, blocked, canceled
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
	Status      string    `db:"status"` // todo, in_progress, review, done, blocked, canceled
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

type ProjectTransition struct {
	ID         string    `db:"id"`
	ProjectID  string    `db:"projectId"`
	FromStatus string    `db:"fromStatus"`
	ToStatus   string    `db:"toStatus"`
	Reason     string    `db:"reason"`
	Actor      string    `db:"actor"`
	CreatedAt  time.Time `db:"createdAt"`
}

type TaskTransition struct {
	ID         string    `db:"id"`
	TaskID     string    `db:"taskId"`
	ProjectID  string    `db:"projectId"`
	FromStatus string    `db:"fromStatus"`
	ToStatus   string    `db:"toStatus"`
	Reason     string    `db:"reason"`
	Actor      string    `db:"actor"`
	CreatedAt  time.Time `db:"createdAt"`
}

type ConversationThread struct {
	ID        string    `db:"id"`
	ProjectID string    `db:"projectId"`
	TaskID    *string   `db:"taskId"`
	Subject   string    `db:"subject"`
	CreatedBy string    `db:"createdBy"`
	Status    string    `db:"status"`
	CreatedAt time.Time `db:"createdAt"`
	UpdatedAt time.Time `db:"updatedAt"`
}

type ConversationMessage struct {
	ID             string    `db:"id"`
	ThreadID       string    `db:"threadId"`
	ProjectID      string    `db:"projectId"`
	TaskID         *string   `db:"taskId"`
	FromEmployeeID *string   `db:"fromEmployeeId"`
	ToEmployeeID   *string   `db:"toEmployeeId"`
	MessageType    string    `db:"messageType"`
	Content        string    `db:"content"`
	Payload        *string   `db:"payload"`
	CreatedAt      time.Time `db:"createdAt"`
}

type EmployeeInbox struct {
	ID         string     `db:"id"`
	EmployeeID string     `db:"employeeId"`
	ProjectID  string     `db:"projectId"`
	TaskID     *string    `db:"taskId"`
	ThreadID   *string    `db:"threadId"`
	MessageID  *string    `db:"messageId"`
	Status     string     `db:"status"`
	ExpiresAt  *time.Time `db:"expiresAt"`
	CreatedAt  time.Time  `db:"createdAt"`
	UpdatedAt  time.Time  `db:"updatedAt"`
}

type InboxItem struct {
	EmployeeInbox
	Subject       *string `db:"subject"`
	Content       *string `db:"content"`
	MessageType   *string `db:"messageType"`
	FromEmployee  *string `db:"fromEmployeeId"`
	ToEmployee    *string `db:"toEmployeeId"`
	ThreadSubject *string `db:"thread_subject"`
}

type TimelineEvent struct {
	ID        string    `db:"id"`
	ProjectID string    `db:"projectId"`
	TaskID    *string   `db:"taskId"`
	EventType string    `db:"eventType"`
	Actor     string    `db:"actor"`
	Summary   string    `db:"summary"`
	Payload   *string   `db:"payload"`
	CreatedAt time.Time `db:"createdAt"`
}
