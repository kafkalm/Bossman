package engine

import (
	"strings"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

func TestWorkerCorePrompt_HasPlanProgressAndSubmitForReview(t *testing.T) {
	if !strings.Contains(workerCorePrompt, "submit_for_review") {
		t.Fatalf("workerCorePrompt should require submit_for_review")
	}
	if !strings.Contains(workerCorePrompt, "report_plan_progress") {
		t.Fatalf("workerCorePrompt should require report_plan_progress")
	}
	if !strings.Contains(workerCorePrompt, "workspace files") {
		t.Fatalf("workerCorePrompt should define phase based on workspace files")
	}
	if !strings.Contains(workerCorePrompt, "Do not keep rewriting plan files") {
		t.Fatalf("workerCorePrompt should forbid plan-only loops in execution phase")
	}
}

func TestFormatProjectContext_RequiresSubmitForReview(t *testing.T) {
	emp := &db.EmployeeWithRole{Employee: db.Employee{Name: "Bob"}, RoleTitle: "Developer"}
	project := &db.Project{Name: "P", Description: "D"}
	task := &db.Task{Title: "T", Description: "Desc"}

	ctx := formatProjectContext(emp, project, task)
	if !strings.Contains(ctx, "submit_for_review") {
		t.Fatalf("project context should require submit_for_review")
	}
	if !strings.Contains(ctx, "report_plan_progress") {
		t.Fatalf("project context should require report_plan_progress")
	}
	if !strings.Contains(ctx, "Your phase is determined by files in your task workspace folder") {
		t.Fatalf("project context should define workspace-driven phase rule")
	}
}
