package bus

import "time"

// BusMessage is an event published on the message bus
type BusMessage struct {
	ID          string
	ProjectID   string
	TaskID      *string
	SenderID    *string
	SenderType  string // founder, agent, system
	MessageType string // deliverable, status_update, discussion, task_assignment, ping
	Content     string
	Metadata    map[string]interface{}
	CreatedAt   time.Time
}
