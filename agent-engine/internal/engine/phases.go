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
	allCompletedOrReviewOrBlocked := true

	for _, t := range tasks {
		if t.Status == "review" {
			hasReview = true
		}
		if t.Status == "blocked" {
			hasBlocked = true
		}
		if t.Status != "completed" {
			allCompleted = false
		}
		if t.Status != "completed" && t.Status != "review" && t.Status != "blocked" {
			allCompletedOrReviewOrBlocked = false
		}
	}

	if hasReview {
		return PhaseTasksInReview
	}
	if hasBlocked {
		return PhaseSomeBlocked
	}
	if allCompleted {
		return PhaseAllTasksCompleted
	}
	hasDocument := project.Document != nil && strings.TrimSpace(*project.Document) != ""
	if hasDocument && allCompletedOrReviewOrBlocked {
		return PhaseDocSavedReadyImpl
	}
	return PhaseHasActiveWork
}

// AllTasksActiveOrInProgress returns true when all tasks are assigned or in_progress (pure waiting)
func AllTasksActiveOrInProgress(tasks []db.TaskWithAssignment) bool {
	if len(tasks) == 0 {
		return false
	}
	for _, t := range tasks {
		if t.Status != "assigned" && t.Status != "in_progress" {
			return false
		}
	}
	return true
}

const ceoRules = `You MUST use tools to take action. Do not just describe — actually do it. Before assigning tasks, decide which roles are actually needed for this project and involve as few employees as necessary — do not assign to every role by default; prefer consolidating work onto fewer people when one role can cover it. In one response you can and should call assign_task multiple times to assign multiple subtasks to the minimal set of involved employees for parallel execution. Assign tasks using roleName (the role: in the team list). Only you decide when a task is done: use approve_task when satisfied, request_revision when not. When the project is ready for handover, set status to "review" (wait for Founder). Only the Founder can set the project to "completed" after acceptance.`

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

Check Recent Messages first. If anyone asked for clarification, answer via ` + "`send_message`" + ` or get an answer via ` + "`request_info`" + ` and then send a summary. Do not ` + "`approve_task`" + ` until clarifications are addressed. For each task in review: if the deliverable is good, use ` + "`approve_task`" + `; if not, use ` + "`request_revision`" + ` with concrete feedback. When all relevant deliverables are approved and questions answered, use ` + "`save_project_document`" + ` (doc phase) or move on.

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

Analyze the Project Document and deliverables. If the project is not complete enough (missing scope, weak quality, or needs another iteration), decide the minimal set of roles needed for the next iteration, then call `+"`assign_task`"+` only for those roles so the team can work in parallel (involve as few employees as necessary). If the project is complete and ready for Founder acceptance, use `+"`update_project_status`"+` to set the project to "review" with a summary. Do NOT set status to "completed" — only the Founder can mark the project completed after acceptance.%s

Take action now.`, lastCycle)

	case PhaseSomeBlocked:
		return preamble + `**Current phase: Some tasks are blocked or failed.**

Decide how to recover: reassign the work, adjust the plan, or ask a team member for clarification. Use ` + "`send_message`" + `, ` + "`request_info`" + `, or ` + "`assign_task`" + ` / ` + "`request_revision`" + ` as needed.

Take action now.`

	default: // PhaseHasActiveWork
		return preamble + `**Current phase: Some tasks are in progress, assigned, or pending.**

Review the state. If any tasks are in review, handle them (approve_task or request_revision). If you need to assign more work or unblock progress, involve only the minimal set of roles needed, then use the appropriate tools. Prefer calling ` + "`assign_task`" + ` multiple times in one response when adding several tasks.

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
