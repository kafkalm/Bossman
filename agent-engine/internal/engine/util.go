package engine

import (
	"fmt"

	"github.com/kafkalm/bossman/agent-engine/internal/bus"
	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

func findEmployeeByRole(employees []db.EmployeeWithRole, roleName string) *db.EmployeeWithRole {
	for i := range employees {
		if employees[i].RoleName == roleName {
			return &employees[i]
		}
	}
	return nil
}

func strOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func containsMarkdownHeaders(s string) bool {
	for i := 0; i < len(s)-2; i++ {
		if s[i] == '#' && (i == 0 || s[i-1] == '\n') {
			return true
		}
	}
	return false
}

func busMessageDeliverable(file *db.ProjectFile, projectID string, taskID *string, senderID *string, title, brief, fileType, tabLabel string) bus.BusMessage {
	return bus.BusMessage{
		ID:          file.ID,
		ProjectID:   projectID,
		TaskID:      taskID,
		SenderID:    senderID,
		SenderType:  "agent",
		MessageType: EngineEventDeliverable,
		Content:     fmt.Sprintf("[agent] 已提交《%s》-> %s", title, tabLabel),
		Metadata:    map[string]interface{}{"fileId": file.ID, "brief": brief, "fileType": fileType},
		CreatedAt:   file.CreatedAt,
	}
}
