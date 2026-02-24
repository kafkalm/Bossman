package engine

import "github.com/kafkalm/bossman/agent-engine/internal/llm"

// workerTools returns the tool definitions available to worker agents.
func workerTools() []llm.ToolDefinition {
	maxTimeout := 300.0
	defaultTimeout := 120.0

	return []llm.ToolDefinition{
		{Name: "report_to_ceo", Description: "Report your progress or results to the CEO. Use this when you've completed a task or have important updates. For documentation, PRDs, design specs, research reports - use this.", Parameters: map[string]*llm.ToolParameter{"report": {Type: "string", Description: "Your report to the CEO, including results, findings, or progress updates"}}, Required: []string{"report"}},
		{Name: "save_to_workspace", Description: "Save a file to your personal workspace (your folder in Document/Code tab). Use this frequently during work: save drafts, outlines, research notes, intermediate code, so your work is persisted and visible.", Parameters: map[string]*llm.ToolParameter{"title": {Type: "string", Description: "Filename with extension, e.g. outline.md, notes.md"}, "content": {Type: "string", Description: "The file content"}, "fileType": {Type: "string", Description: "'document' for markdown/text, 'code' for source code", Enum: []string{"document", "code"}, Default: "document"}}, Required: []string{"title", "content"}},
		{Name: "create_file", Description: "Create and submit a file deliverable to the project. Use for final code (e.g. .tsx, .py) or docs. Save intermediate work with save_to_workspace instead.", Parameters: map[string]*llm.ToolParameter{"title": {Type: "string", Description: "Filename with extension, e.g. Button.tsx, api.py"}, "content": {Type: "string", Description: "The file content (source code or text)"}, "fileType": {Type: "string", Description: "Use 'code' for source code (ts, tsx, py, etc.); use 'document' for markdown/docs", Enum: []string{"document", "code"}, Default: "code"}}, Required: []string{"title", "content"}},
		{Name: "list_workspace_files", Description: "List files in the project workspace (.bossman_workspace/projectId/). Returns relative paths you can pass to read_file.", Parameters: map[string]*llm.ToolParameter{}, Required: []string{}},
		{Name: "read_file", Description: "Read a file from the project workspace. Use the relativePath returned by list_workspace_files (e.g. 'employeeId/docs/outline.md').", Parameters: map[string]*llm.ToolParameter{"relativePath": {Type: "string", Description: "Path to the file relative to the project workspace, e.g. 'employeeId/docs/notes.md'"}}, Required: []string{"relativePath"}},
		{Name: "ask_colleague", Description: "Ask a question to a colleague in another role and get their response immediately. Use this when you need information from another team member.", Parameters: map[string]*llm.ToolParameter{"colleague_role": {Type: "string", Description: "The role of the colleague you want to ask (e.g., 'backend-dev', 'ui-designer')"}, "question": {Type: "string", Description: "The question you want to ask"}}, Required: []string{"colleague_role", "question"}},
		{Name: "execute_command", Description: "Execute a shell command in the project workspace and capture output. Use for running builds, tests, installing packages, or any shell operation needed for the task.", Parameters: map[string]*llm.ToolParameter{"command": {Type: "string", Description: "The shell command to execute (runs in /bin/sh -c)"}, "workdir": {Type: "string", Description: "Working directory relative to project workspace root (optional, defaults to project root)"}, "timeout_seconds": {Type: "number", Description: "Command timeout in seconds (default: 120, max: 300)", Maximum: &maxTimeout, Default: defaultTimeout}}, Required: []string{"command"}},
	}
}
