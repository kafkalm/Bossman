# Notion + GitHub + Codex Ops Setup

## 1. Required GitHub Secrets

Set these repository secrets:

- `NOTION_TOKEN`
- `NOTION_TASK_DB_ID`
- `NOTION_PORTFOLIO_DB_ID` (reserved for dashboard expansion)

## 2. Required Notion Database Properties

Task mirror database should contain:

- `Title` (title)
- `GitHub Item Key` (rich text, unique)
- `GitHub Issue ID` (number)
- `Repo` (select)
- `Status` (select: Planned, Doing, Reviewing, Blocked, Done)
- `Priority` (select: P0, P1, P2, P3)
- `Estimate` (select: XS, S, M, L, XL)
- `Blocked` (checkbox)
- `GitHub URL` (url)
- `PR URL` (url)
- `Work Type` (select: feature, bug, chore, research)
- `Last Synced At` (date)

## 3. Bootstrap Labels

Run in repo root:

```bash
.github/scripts/bootstrap_labels.sh
```

## 4. Workflow Behavior

- `.github/workflows/notion-sync.yml`
  - Event-driven sync on issue/pr/review updates.
- `.github/workflows/notion-reconcile.yml`
  - Daily reconciliation (01:17 UTC) for last 30 days.

## 5. Codex Execution Contract

- Start work from a GitHub issue.
- Use branch naming: `<type>/<issue-number>-<slug>`.
- PR must link issue and include validation evidence.
