package engine

import "github.com/kafkalm/bossman/agent-engine/internal/llm"

// workerTools returns the tool definitions available to worker agents.
func workerTools() []llm.ToolDefinition {
	maxTimeout := 300.0
	defaultTimeout := 120.0

	return []llm.ToolDefinition{
		{Name: "save_to_workspace", Description: "Save a file to your personal workspace (your folder in Document/Code tab). First cycle must include a concrete execution plan saved here before final delivery.", Parameters: map[string]*llm.ToolParameter{"title": {Type: "string", Description: "Filename with extension, e.g. plan.md, outline.md, notes.md"}, "content": {Type: "string", Description: "The file content"}, "fileType": {Type: "string", Description: "'document' for markdown/text, 'code' for source code", Enum: []string{"document", "code"}, Default: "document"}}, Required: []string{"title", "content"}},
		{Name: "create_file", Description: "Create and submit a concrete deliverable to the project. Before this, ensure plan + self-check have been completed.", Parameters: map[string]*llm.ToolParameter{"title": {Type: "string", Description: "Filename with extension, e.g. Button.tsx, api.py"}, "content": {Type: "string", Description: "The file content (source code or text)"}, "fileType": {Type: "string", Description: "Use 'code' for source code (ts, tsx, py, etc.); use 'document' for markdown/docs", Enum: []string{"document", "code"}, Default: "code"}}, Required: []string{"title", "content"}},
		{Name: "submit_for_review", Description: "Explicitly submit this task for CEO review after all deliverables are finished. This is the only tool that can move task status to review.", Parameters: map[string]*llm.ToolParameter{"summary": {Type: "string", Description: "Concise completion summary of what was delivered"}, "deliverables": {Type: "array", Description: "Workspace relative paths of final deliverable files (must exist)", Items: &llm.ToolParameter{Type: "string"}}, "self_check": {Type: "string", Description: "Self-check on requirement coverage, quality, known risks, and next steps"}}, Required: []string{"summary", "deliverables", "self_check"}},
		{Name: "list_workspace_files", Description: "List files in the project workspace (.bossman_workspace/projectId/). Returns relative paths you can pass to read_file.", Parameters: map[string]*llm.ToolParameter{}, Required: []string{}},
		{Name: "read_file", Description: "Read a file from the project workspace. Use the relativePath returned by list_workspace_files (e.g. 'employeeId/docs/outline.md').", Parameters: map[string]*llm.ToolParameter{"relativePath": {Type: "string", Description: "Path to the file relative to the project workspace, e.g. 'employeeId/docs/notes.md'"}}, Required: []string{"relativePath"}},
		{Name: "execute_command", Description: "Execute a shell command in the project workspace and capture output. Use for running builds, tests, installing packages, or any shell operation needed for the task.", Parameters: map[string]*llm.ToolParameter{"command": {Type: "string", Description: "The shell command to execute (runs in /bin/sh -c)"}, "workdir": {Type: "string", Description: "Working directory relative to project workspace root (optional, defaults to project root)"}, "timeout_seconds": {Type: "number", Description: "Command timeout in seconds (default: 120, max: 300)", Maximum: &maxTimeout, Default: defaultTimeout}}, Required: []string{"command"}},
	}
}
