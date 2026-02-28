import fs from 'node:fs';
import {
  buildTaskProperties,
  ensurePortfolioTaskRelation,
  toTaskPayloadFromIssue,
  upsertPortfolioProjectPage,
  upsertTaskPage,
} from './notion_sync_core.mjs';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function loadEventPayload() {
  const eventPath = requireEnv('GITHUB_EVENT_PATH');
  const raw = fs.readFileSync(eventPath, 'utf8');
  return JSON.parse(raw);
}

function toSyncInput({ payload, repo }) {
  if (payload.issue) {
    return toTaskPayloadFromIssue({ repo, issue: payload.issue });
  }

  if (payload.pull_request) {
    const pr = payload.pull_request;
    return {
      repo,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      issueState: pr.state,
      labels: pr.labels || [],
      body: pr.body || '',
      prUrl: pr.html_url,
      hasOpenPr: pr.state === 'open',
      createdAt: pr.created_at || null,
      doneAt: pr.closed_at || null,
      syncedAt: new Date().toISOString(),
    };
  }

  return null;
}

async function main() {
  const notionToken = requireEnv('NOTION_TOKEN');
  const taskDbId = requireEnv('NOTION_TASK_DB_ID');
  const portfolioDbId = requireEnv('NOTION_PORTFOLIO_DB_ID');
  const repo = requireEnv('GITHUB_REPOSITORY');

  const payload = loadEventPayload();
  const syncInput = toSyncInput({ payload, repo });

  if (!syncInput) {
    console.log('No issue/pr payload found. Skip.');
    return;
  }

  const portfolioProject = await upsertPortfolioProjectPage({
    token: notionToken,
    dbId: portfolioDbId,
    repo,
  });
  const properties = buildTaskProperties({
    ...syncInput,
    projectPageId: portfolioProject.id,
  });
  const result = await upsertTaskPage({ token: notionToken, dbId: taskDbId, properties });
  await ensurePortfolioTaskRelation({
    token: notionToken,
    portfolioPageId: portfolioProject.id,
    taskPageId: result.id,
  });

  console.log(`Notion ${result.mode}: ${result.id}`);
  console.log(`Synced ${repo}#${syncInput.number}`);
  console.log(`Portfolio ${portfolioProject.mode}: ${portfolioProject.id}`);
  if (result.deduped) {
    console.log(`Task deduped: archived ${result.deduped} duplicate pages`);
  }
  if (portfolioProject.deduped) {
    console.log(`Portfolio deduped: archived ${portfolioProject.deduped} duplicate pages`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
