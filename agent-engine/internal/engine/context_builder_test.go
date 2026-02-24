package engine

import (
	"testing"
	"time"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
	"github.com/kafkalm/bossman/agent-engine/internal/llm"
)

func TestMergeAndDedup_Table(t *testing.T) {
	now := time.Now()
	a := []db.Message{{ID: "1", CreatedAt: now.Add(2 * time.Second)}, {ID: "2", CreatedAt: now.Add(4 * time.Second)}}
	b := []db.Message{{ID: "2", CreatedAt: now.Add(4 * time.Second)}, {ID: "3", CreatedAt: now.Add(1 * time.Second)}}

	merged := mergeAndDedup(a, b)
	if len(merged) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(merged))
	}
	if merged[0].ID != "3" || merged[1].ID != "1" || merged[2].ID != "2" {
		t.Fatalf("unexpected order: %+v", []string{merged[0].ID, merged[1].ID, merged[2].ID})
	}
}

func TestTrimContext_KeepsHeadAndRecent(t *testing.T) {
	messages := make([]llm.ChatMessage, 0, maxContextMessages+10)
	for i := 0; i < maxContextMessages+10; i++ {
		messages = append(messages, llm.ChatMessage{Role: "user", Content: string(rune('a' + (i % 26)))})
	}
	trimmed := trimContext(messages)
	if len(trimmed) != maxContextMessages {
		t.Fatalf("expected %d messages, got %d", maxContextMessages, len(trimmed))
	}
	if trimmed[0].Content != messages[0].Content {
		t.Fatalf("first message should be preserved")
	}
	if trimmed[len(trimmed)-1].Content != messages[len(messages)-1].Content {
		t.Fatalf("last message should be latest")
	}
}
