package engine

import "strings"

const systemCorePrompt = `System Core (immutable):
- Follow strict state transitions. Never propose or execute illegal transitions.
- Use tools for concrete actions. Do not end with analysis-only when action is required.
- If no direct tool applies, produce an explicit fallback action and rationale.
- Keep outputs concise, verifiable, and tied to task/project state.
`

const ceoCorePrompt = `CEO Core Rules:
- In review phase, every task in review must receive one decision: approve_task, request_revision, or block_task.
- Use task updates/reassignment to drive collaboration; do not rely on message passing.
- Prefer minimal-role assignment strategy.
`

const workerCorePrompt = `Worker Core Rules:
- Phase protocol is based on workspace files (not task status):
  1) If no plan file exists in your task folder, produce a concrete execution plan and save it (plan.md/outline.md/checklist.md).
  2) If a plan file already exists, continue execution and produce non-plan deliverable files.
  3) Do not keep rewriting plan files once execution phase has started.
- Every round, you must call report_plan_progress exactly once:
  - include completed_items / in_progress_items / next_items / blocked_items
  - include updated_plan_content as the full updated plan text
  - include summary for this round
- In execution phase, report_plan_progress must reflect real execution:
  - at least one non-plan deliverable file this round
  - completed_items is non-empty, or blocked_items explains why progress is blocked
- Task status only enters review when you explicitly call submit_for_review.
- Plan or intermediate files alone must stay in in_progress (not review).
- Before creating final deliverable, run a self-check:
  - requirement coverage,
  - correctness/consistency,
  - explicit risks or missing inputs.
- If blocked by missing information, write structured blocker details in task output.
- If no strong deliverable is available, produce a minimal progress note and explain next step.
`

func buildSystemPrompt(roleName, rolePrompt string) string {
	var b strings.Builder
	b.WriteString(systemCorePrompt)
	switch roleName {
	case "ceo":
		b.WriteString("\n")
		b.WriteString(ceoCorePrompt)
	default:
		b.WriteString("\n")
		b.WriteString(workerCorePrompt)
	}
	if strings.TrimSpace(rolePrompt) != "" {
		b.WriteString("\nRole Prompt:\n")
		b.WriteString(rolePrompt)
	}
	return b.String()
}
