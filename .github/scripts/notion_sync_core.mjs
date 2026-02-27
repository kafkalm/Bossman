const NOTION_VERSION = '2022-06-28';

export function labelNames(labels = []) {
  return labels
    .map((label) => (typeof label === 'string' ? label : label?.name || ''))
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

export function inferWorkType(labels = []) {
  const names = labelNames(labels);
  if (names.includes('type:feature')) return 'feature';
  if (names.includes('type:bug')) return 'bug';
  if (names.includes('type:research')) return 'research';
  return 'chore';
}

export function inferPriority(labels = []) {
  const names = labelNames(labels);
  if (names.includes('prio:p0')) return 'P0';
  if (names.includes('prio:p1')) return 'P1';
  if (names.includes('prio:p3')) return 'P3';
  return 'P2';
}

export function inferBlocked(labels = []) {
  const names = labelNames(labels);
  return names.includes('blocked') || names.includes('status:blocked');
}

export function mapNotionStatus({ issueState, labels = [], hasOpenPr = false }) {
  if (inferBlocked(labels)) return 'Blocked';
  if (issueState === 'closed') return 'Done';

  const names = labelNames(labels);
  if (names.includes('status:backlog') || names.includes('status:ready')) return 'Planned';
  if (names.includes('status:review') || hasOpenPr) return 'Reviewing';
  if (names.includes('status:done')) return 'Done';
  return 'Doing';
}

export function extractEstimate(body = '') {
  const match = body.match(/estimate\s*:\s*(XS|S|M|L|XL)/i);
  return match ? match[1].toUpperCase() : 'M';
}

export function buildGithubItemKey(repo, number) {
  return `${repo}#${number}`;
}

export function defaultPortfolioTitle(repo) {
  return String(repo || '').split('/').pop() || 'Repository';
}

export function buildPortfolioProjectProperties({ repo, syncedAt = new Date().toISOString() }) {
  return {
    Title: {
      title: [{ text: { content: defaultPortfolioTitle(repo).slice(0, 1900) } }],
    },
    'Project Key': {
      rich_text: [{ text: { content: repo } }],
    },
    Status: {
      select: { name: 'Active' },
    },
    'Repository URL': {
      url: `https://github.com/${repo}`,
    },
    'Last Synced At': {
      date: { start: syncedAt },
    },
  };
}

export function buildTaskProperties({ repo, number, title, url, issueState, labels = [], body = '', prUrl = null, syncedAt = new Date().toISOString(), hasOpenPr = false, projectPageId = null }) {
  const notionStatus = mapNotionStatus({ issueState, labels, hasOpenPr });
  const workType = inferWorkType(labels);
  const priority = inferPriority(labels);
  const estimate = extractEstimate(body);
  const blocked = inferBlocked(labels);
  const itemKey = buildGithubItemKey(repo, number);

  const properties = {
    Title: {
      title: [{ text: { content: title.slice(0, 1900) } }],
    },
    'GitHub Item Key': {
      rich_text: [{ text: { content: itemKey } }],
    },
    'GitHub Issue ID': {
      number,
    },
    Repo: {
      select: { name: repo },
    },
    Status: {
      select: { name: notionStatus },
    },
    Priority: {
      select: { name: priority },
    },
    Estimate: {
      select: { name: estimate },
    },
    Blocked: {
      checkbox: blocked,
    },
    'GitHub URL': {
      url,
    },
    'Last Synced At': {
      date: { start: syncedAt },
    },
    'Work Type': {
      select: { name: workType },
    },
  };

  if (prUrl) {
    properties['PR URL'] = { url: prUrl };
  }

  if (projectPageId) {
    properties.Project = {
      relation: [{ id: projectPageId }],
    };
  }

  return properties;
}

export function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export async function notionRequest(path, { token, method = 'GET', body = undefined }) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: notionHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion API ${method} ${path} failed: ${response.status} ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function findPageByItemKey({ token, dbId, itemKey }) {
  const result = await notionRequest(`/databases/${dbId}/query`, {
    token,
    method: 'POST',
    body: {
      page_size: 100,
      filter: {
        property: 'GitHub Item Key',
        rich_text: {
          equals: itemKey,
        },
      },
    },
  });

  return result.results || [];
}

export async function findPortfolioProjectByKey({ token, dbId, projectKey }) {
  const result = await notionRequest(`/databases/${dbId}/query`, {
    token,
    method: 'POST',
    body: {
      page_size: 100,
      filter: {
        property: 'Project Key',
        rich_text: {
          equals: projectKey,
        },
      },
    },
  });

  return result.results || [];
}

function selectCanonicalAndDuplicates(pages = []) {
  if (!pages.length) {
    return { canonical: null, duplicates: [] };
  }

  const sorted = [...pages].sort((a, b) => {
    const ta = a.created_time || '';
    const tb = b.created_time || '';
    if (ta !== tb) return ta.localeCompare(tb);
    return (a.id || '').localeCompare(b.id || '');
  });

  return {
    canonical: sorted[0],
    duplicates: sorted.slice(1),
  };
}

async function archivePages({ token, pages = [] }) {
  for (const page of pages) {
    await notionRequest(`/pages/${page.id}`, {
      token,
      method: 'PATCH',
      body: { archived: true },
    });
  }
}

export async function upsertPortfolioProjectPage({ token, dbId, repo }) {
  const properties = buildPortfolioProjectProperties({
    repo,
    syncedAt: new Date().toISOString(),
  });
  const all = await findPortfolioProjectByKey({
    token,
    dbId,
    projectKey: repo,
  });
  const { canonical, duplicates } = selectCanonicalAndDuplicates(all);

  if (canonical) {
    const updated = await notionRequest(`/pages/${canonical.id}`, {
      token,
      method: 'PATCH',
      body: { properties },
    });
    if (duplicates.length) {
      await archivePages({ token, pages: duplicates });
    }
    return { mode: 'updated', id: updated.id, deduped: duplicates.length };
  }

  const created = await notionRequest('/pages', {
    token,
    method: 'POST',
    body: {
      parent: { database_id: dbId },
      properties,
    },
  });

  return { mode: 'created', id: created.id, deduped: 0 };
}

export async function upsertTaskPage({ token, dbId, properties }) {
  const key = properties['GitHub Item Key'].rich_text[0].text.content;
  const all = await findPageByItemKey({ token, dbId, itemKey: key });
  const { canonical, duplicates } = selectCanonicalAndDuplicates(all);

  if (canonical) {
    const updated = await notionRequest(`/pages/${canonical.id}`, {
      token,
      method: 'PATCH',
      body: { properties },
    });
    if (duplicates.length) {
      await archivePages({ token, pages: duplicates });
    }
    return { mode: 'updated', id: updated.id, deduped: duplicates.length };
  }

  const created = await notionRequest('/pages', {
    token,
    method: 'POST',
    body: {
      parent: { database_id: dbId },
      properties,
    },
  });

  return { mode: 'created', id: created.id, deduped: 0 };
}

export function toTaskPayloadFromIssue({ repo, issue, prUrl = null, hasOpenPr = false }) {
  return {
    repo,
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    issueState: issue.state,
    labels: issue.labels || [],
    body: issue.body || '',
    prUrl,
    hasOpenPr,
    syncedAt: new Date().toISOString(),
  };
}
