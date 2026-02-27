package engine

import (
	"fmt"
	"strings"

	"github.com/kafkalm/bossman/agent-engine/internal/db"
)

// CeoPhase represents the current state of the project from the CEO's perspective
type CeoPhase int

const (
	PhaseNoTasks CeoPhase = iota
	PhaseTasksInReview
	PhaseSomeBlocked
	PhaseAllTasksCompleted
	PhaseDocSavedReadyImpl
	PhaseHasActiveWork
)

// GetCeoPhase determines which CEO phase applies based on current project state
func GetCeoPhase(project *db.Project, tasks []db.TaskWithAssignment) CeoPhase {
	if len(tasks) == 0 {
		return PhaseNoTasks
	}

	hasReview := false
	hasBlocked := false
	allCompleted := true

	for _, t := range tasks {
		if normalizeTaskStatus(t.Status) == TaskStatusReview {
			hasReview = true
		}
		if normalizeTaskStatus(t.Status) == TaskStatusBlocked {
			hasBlocked = true
		}
		if normalizeTaskStatus(t.Status) != TaskStatusDone {
			allCompleted = false
		}
	}

	if hasReview {
		return PhaseTasksInReview
	}
	if hasBlocked {
		return PhaseSomeBlocked
	}
	if allCompleted {
		hasDocument := project.Document != nil && strings.TrimSpace(*project.Document) != ""
		if hasDocument {
			return PhaseDocSavedReadyImpl
		}
		return PhaseAllTasksCompleted
	}
	return PhaseHasActiveWork
}

// AllTasksActiveOrInProgress returns true only when every task is runnable/waiting:
// status is todo/in_progress AND each task already has an assignee.
func AllTasksActiveOrInProgress(tasks []db.TaskWithAssignment) bool {
	if len(tasks) == 0 {
		return false
	}
	for _, t := range tasks {
		status := normalizeTaskStatus(t.Status)
		if status != TaskStatusTodo && status != TaskStatusInProgress {
			return false
		}
		if t.AssigneeID == nil {
			return false
		}
	}
	return true
}

const ceoRules = `System Core Constraints:
- You MUST use tools to take action. Do not end a cycle with plain analysis only.
- State machine is strict. Do not attempt illegal transitions.
- In review phase, each review task must receive exactly one decision: approve_task, request_revision, or block_task.
- Team collaboration must happen via task changes only (task updates, reassignments, status changes).
- If no tool seems applicable, execute a fallback task action: update_task, request_revision, or unblock_task with explicit next step.
`

func buildPreamble(project *db.Project, snapshot string, iteration, maxIterations int) string {
	desc := ""
	if project.Description != "" {
		desc = fmt.Sprintf("Project brief: %s\n", project.Description)
	}
	return fmt.Sprintf(`You are the CEO managing the project **"%s"**.
%sThis is **management cycle %d/%d**.

Current state:

%s

---

%s

`, project.Name, desc, iteration+1, maxIterations, snapshot, ceoRules)
}

// BuildPromptForPhase constructs the CEO prompt for the given phase
func BuildPromptForPhase(phase CeoPhase, project *db.Project, snapshot string, iteration, maxIterations int) string {
	preamble := buildPreamble(project, snapshot, iteration, maxIterations)
	switch phase {
	case PhaseNoTasks:
		return preamble + `**Current phase: Project start — no tasks yet.**

First decide which roles are actually needed for this project (involve as few employees as possible). Consider scope and complexity: a small project may need only 1–2 roles (e.g. PM + one developer); only add more roles when the work clearly requires them. Then break the project into subtasks and call ` + "`assign_task`" + ` only for the roles you decided to involve — one or more tasks per involved role so they work concurrently. Prefer one person handling related work when their role fits. Start with the documentation phase. Take action now.`

	case PhaseTasksInReview:
		return preamble + `**Current phase: Tasks in review or team has questions.**

Check task outputs and workspace files first. Do not use message passing for coordination.

For each task in review: choose exactly one action: ` + "`approve_task`" + ` / ` + "`request_revision`" + ` / ` + "`block_task`" + `.

Hard requirement for this cycle: you MUST produce decision tools for all review tasks. Do NOT return only analysis text.

When all relevant deliverables are approved and questions answered, use ` + "`save_project_document`" + ` (doc phase) or move on.

Take action now.`

	case PhaseDocSavedReadyImpl:
		return preamble + `**Current phase: Project document is saved; plan the implementation phase.**

Decide the minimal set of roles needed for implementation (involve as few employees as necessary). Then break the project into concrete implementation subtasks and call ` + "`assign_task`" + ` only for those roles — multiple tasks can go to the same role when appropriate. Assign in one response so involved engineers work concurrently.

Take action now.`

	case PhaseAllTasksCompleted:
		lastCycle := ""
		if iteration+1 >= maxIterations {
			lastCycle = fmt.Sprintf(` This is your last cycle (%d/%d); you MUST either set status to "review" or assign more tasks.`, iteration+1, maxIterations)
		}
		return preamble + fmt.Sprintf(`**Current phase: All tasks are completed.**

Analyze the Project Document and deliverables. If the project is not complete enough (missing scope, weak quality, or needs another iteration), decide the minimal set of roles needed for the next iteration, then call `+"`assign_task`"+` only for those roles so the team can work in parallel (involve as few employees as necessary). If the project is complete and ready for Founder acceptance, use `+"`update_project_status`"+` to set status to "review" with a summary.%s

Take action now.`, lastCycle)

	case PhaseSomeBlocked:
		return preamble + `**Current phase: Some tasks are blocked or failed.**

Decide how to recover by task actions only: use ` + "`unblock_task`" + `, ` + "`reassign_task`" + `, ` + "`update_task`" + `, or ` + "`request_revision`" + `.
If rescheduling an existing blocked task, call ` + "`reassign_task`" + ` or ` + "`unblock_task`" + ` so the same task returns to todo and becomes executable.

Take action now.`

	default: // PhaseHasActiveWork
		return preamble + `**Current phase: Some tasks are in progress or todo.**

Review the state. If any tasks are in review, handle them with explicit decisions. If you need to assign more work or unblock progress, involve only the minimal set of roles needed, then use the appropriate tools. Prefer calling ` + "`assign_task`" + ` multiple times in one response when adding several tasks.

Take action now.`
	}
}

// BuildFounderPrompt builds the prompt for responding to a Founder message
func BuildFounderPrompt(founderMessage, snapshot string) string {
	return fmt.Sprintf(`[Founder]: %s

---

%s

Respond to the Founder's message. If action is needed, use the appropriate tools. If the Founder asks you to resume work or compile a document, take the corresponding action.`, founderMessage, snapshot)
}
