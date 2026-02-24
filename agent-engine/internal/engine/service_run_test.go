package engine

import (
	"strings"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

func TestComposeRolePromptWithSkills(t *testing.T) {
	desc := "Write robust tests"
	skills := []db.Skill{
		{
			Name:        "testing",
			Description: &desc,
			Content:     "Use table-driven tests.\nCover edge cases.",
		},
	}
	out := composeRolePromptWithSkills("Base role prompt.", skills)
	if !strings.Contains(out, "Base role prompt.") {
		t.Fatalf("expected base role prompt in output")
	}
	if !strings.Contains(out, "Skill: testing") {
		t.Fatalf("expected skill name in output")
	}
	if !strings.Contains(out, "Use table-driven tests.") {
		t.Fatalf("expected skill content in output")
	}
}

