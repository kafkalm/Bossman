package engine

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
	"github.com/kafkalm/bossman/agent-engine/internal/workspace"
)

type fakeLLM struct {
	resp           *llm.LLMResponse
	responses      []*llm.LLMResponse
	err            error
	lastMessages   []llm.ChatMessage
	messagesByCall [][]llm.ChatMessage
	callCount      int
}

func (f *fakeLLM) Call(cfg llm.ModelConfig, messages []llm.ChatMessage, system string, tools []llm.ToolDefinition, opts llm.CallOptions) (*llm.LLMResponse, error) {
	snapshot := append([]llm.ChatMessage(nil), messages...)
	f.lastMessages = snapshot
	f.messagesByCall = append(f.messagesByCall, snapshot)
	f.callCount++
	if f.err != nil {
		return nil, f.err
	}
	if len(f.responses) > 0 {
		idx := f.callCount - 1
		if idx < len(f.responses) {
			return f.responses[idx], nil
		}
		return f.responses[len(f.responses)-1], nil
	}
	if f.resp == nil {
		return &llm.LLMResponse{}, nil
	}
	return f.resp, nil
}

type fakeRunState struct {
	projectID string
	wakes     []string
}

func (f *fakeRunState) ProjectID() string            { return f.projectID }
func (f *fakeRunState) WakeWorker(employeeID string) { f.wakes = append(f.wakes, employeeID) }
func (f *fakeRunState) TriggerCEO()                  {}

func newTestDB(t *testing.T) *db.DB {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	schema := []string{
		`CREATE TABLE Project (id TEXT PRIMARY KEY, companyId TEXT, name TEXT, description TEXT, document TEXT, status TEXT, createdAt DATETIME, updatedAt DATETIME);`,
		`CREATE TABLE AgentRole (id TEXT PRIMARY KEY, name TEXT, title TEXT, systemPrompt TEXT, modelConfig TEXT, capabilities TEXT, isBuiltin BOOLEAN, createdAt DATETIME, updatedAt DATETIME);`,
		`CREATE TABLE Employee (id TEXT PRIMARY KEY, companyId TEXT, roleId TEXT, name TEXT, status TEXT, createdAt DATETIME, updatedAt DATETIME);`,
		`CREATE TABLE Task (id TEXT PRIMARY KEY, projectId TEXT, parentId TEXT, title TEXT, description TEXT, status TEXT, priority INTEGER, output TEXT, createdAt DATETIME, updatedAt DATETIME);`,
		`CREATE TABLE TaskAssignment (id TEXT PRIMARY KEY, taskId TEXT, employeeId TEXT, assignedAt DATETIME);`,
		`CREATE TABLE Message (id TEXT PRIMARY KEY, projectId TEXT, taskId TEXT, senderId TEXT, senderType TEXT, content TEXT, metadata TEXT, createdAt DATETIME);`,
		`CREATE TABLE ProjectFile (id TEXT PRIMARY KEY, projectId TEXT, employeeId TEXT, taskId TEXT, title TEXT, path TEXT, content TEXT, brief TEXT, fileType TEXT, createdAt DATETIME);`,
		`CREATE TABLE TokenUsage (id TEXT PRIMARY KEY, employeeId TEXT, projectId TEXT, model TEXT, provider TEXT, inputTokens INTEGER, outputTokens INTEGER, cost REAL, createdAt DATETIME);`,
		`CREATE TABLE project_transitions (id TEXT PRIMARY KEY, projectId TEXT, fromStatus TEXT, toStatus TEXT, reason TEXT, actor TEXT, createdAt DATETIME);`,
		`CREATE TABLE task_transitions (id TEXT PRIMARY KEY, taskId TEXT, projectId TEXT, fromStatus TEXT, toStatus TEXT, reason TEXT, actor TEXT, createdAt DATETIME);`,
		`CREATE TABLE conversation_threads (id TEXT PRIMARY KEY, projectId TEXT, taskId TEXT, subject TEXT, createdBy TEXT, status TEXT, createdAt DATETIME, updatedAt DATETIME);`,
		`CREATE TABLE conversation_messages (id TEXT PRIMARY KEY, threadId TEXT, projectId TEXT, taskId TEXT, fromEmployeeId TEXT, toEmployeeId TEXT, messageType TEXT, content TEXT, payload TEXT, createdAt DATETIME);`,
		`CREATE TABLE employee_inbox (id TEXT PRIMARY KEY, employeeId TEXT, projectId TEXT, taskId TEXT, threadId TEXT, messageId TEXT, status TEXT, expiresAt DATETIME, createdAt DATETIME, updatedAt DATETIME);`,
		`CREATE TABLE engine_timeline_events (id TEXT PRIMARY KEY, projectId TEXT, taskId TEXT, eventType TEXT, actor TEXT, summary TEXT, payload TEXT, createdAt DATETIME);`,
	}
	for _, s := range schema {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("schema exec failed: %v", err)
		}
	}
	return database
}

func seedBasicProjectData(t *testing.T, database *db.DB) {
	t.Helper()
	now := time.Now()
	_, err := database.Exec(`INSERT INTO Project (id, companyId, name, description, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"proj-1", "comp-1", "Project", "Desc", ProjectStatusActive, now, now)
	if err != nil {
		t.Fatalf("insert project: %v", err)
	}
	_, err = database.Exec(`INSERT INTO AgentRole (id, name, title, systemPrompt, modelConfig, isBuiltin, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"role-ceo", "ceo", "CEO", "sys", `{"provider":"openai","model":"gpt-4o-mini"}`, true, now, now)
	if err != nil {
		t.Fatalf("insert role ceo: %v", err)
	}
	_, err = database.Exec(`INSERT INTO AgentRole (id, name, title, systemPrompt, modelConfig, isBuiltin, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"role-dev", "dev", "Developer", "sys", `{"provider":"openai","model":"gpt-4o-mini"}`, true, now, now)
	if err != nil {
		t.Fatalf("insert role dev: %v", err)
	}
	_, err = database.Exec(`INSERT INTO Employee (id, companyId, roleId, name, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"emp-ceo", "comp-1", "role-ceo", "Alice", "idle", now, now)
	if err != nil {
		t.Fatalf("insert employee ceo: %v", err)
	}
	_, err = database.Exec(`INSERT INTO Employee (id, companyId, roleId, name, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"emp-dev", "comp-1", "role-dev", "Bob", "idle", now, now)
	if err != nil {
		t.Fatalf("insert employee dev: %v", err)
	}
}

func newTestService(t *testing.T, database *db.DB, llmCaller LLMCaller) *Service {
	t.Helper()
	ws := workspace.New(filepath.Join(t.TempDir(), "ws"))
	return &Service{
		db:        database,
		bus:       bus.New(),
		llm:       llmCaller,
		workspace: ws,
		workers:   map[string]*Worker{},
		ceos:      map[string]*CEO{},
	}
}

func mustTaskStatus(t *testing.T, database *db.DB, taskID string) string {
	t.Helper()
	task, err := database.GetTask(context.Background(), taskID)
	if err != nil {
		t.Fatalf("load task %s: %v", taskID, err)
	}
	return task.Status
}

func insertAssignedTask(t *testing.T, database *db.DB, taskID, status, output string) {
	t.Helper()
	now := time.Now()
	var out any
	if output != "" {
		out = output
	}
	_, err := database.Exec(`INSERT INTO Task (id, projectId, title, description, status, priority, output, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		taskID, "proj-1", fmt.Sprintf("Task %s", taskID), "desc", status, 5, out, now, now)
	if err != nil {
		t.Fatalf("insert task: %v", err)
	}
	_, err = database.Exec(`INSERT INTO TaskAssignment (id, taskId, employeeId, assignedAt) VALUES (?, ?, ?, ?)`,
		"ta-"+taskID, taskID, "emp-dev", now)
	if err != nil {
		t.Fatalf("insert assignment: %v", err)
	}
}
