package engine

import (
	"strings"
	"testing"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

func TestWorkerCorePrompt_NoReportAndHasSubmitForReview(t *testing.T) {
	if strings.Contains(workerCorePrompt, "report_to_ceo") || strings.Contains(workerCorePrompt, "create_file/report_to_ceo") {
		t.Fatalf("workerCorePrompt should not reference report_to_ceo")
	}
	if !strings.Contains(workerCorePrompt, "submit_for_review") {
		t.Fatalf("workerCorePrompt should require submit_for_review")
	}
}

func TestFormatProjectContext_RequiresSubmitForReview(t *testing.T) {
	emp := &db.EmployeeWithRole{Employee: db.Employee{Name: "Bob"}, RoleTitle: "Developer"}
	project := &db.Project{Name: "P", Description: "D"}
	task := &db.Task{Title: "T", Description: "Desc"}

	ctx := formatProjectContext(emp, project, task)
	if strings.Contains(ctx, "report") {
		t.Fatalf("project context should not mention report-based delivery")
	}
	if !strings.Contains(ctx, "submit_for_review") {
		t.Fatalf("project context should require submit_for_review")
	}
}

