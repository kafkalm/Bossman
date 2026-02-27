import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferPriority,
  inferWorkType,
  mapNotionStatus,
  buildTaskProperties,
  buildGithubItemKey,
} from './notion_sync_core.mjs';

test('inferPriority maps labels to priority', () => {
  assert.equal(inferPriority([{ name: 'prio:p0' }]), 'P0');
  assert.equal(inferPriority([{ name: 'prio:p1' }]), 'P1');
  assert.equal(inferPriority([{ name: 'something-else' }]), 'P2');
});

test('inferWorkType maps labels to work type', () => {
  assert.equal(inferWorkType([{ name: 'type:bug' }]), 'bug');
  assert.equal(inferWorkType([{ name: 'type:feature' }]), 'feature');
  assert.equal(inferWorkType([]), 'chore');
});

test('mapNotionStatus resolves blocked and done first', () => {
  assert.equal(mapNotionStatus({ issueState: 'open', labels: [{ name: 'blocked' }] }), 'Blocked');
  assert.equal(mapNotionStatus({ issueState: 'closed', labels: [] }), 'Done');
  assert.equal(mapNotionStatus({ issueState: 'open', labels: [{ name: 'status:review' }] }), 'Reviewing');
});

test('buildGithubItemKey is deterministic', () => {
  assert.equal(buildGithubItemKey('kafkalm/Bossman', 123), 'kafkalm/Bossman#123');
});

test('buildTaskProperties creates required Notion fields', () => {
  const props = buildTaskProperties({
    repo: 'kafkalm/Bossman',
    number: 77,
    title: 'Test title',
    url: 'https://github.com/kafkalm/Bossman/issues/77',
    issueState: 'open',
    labels: [{ name: 'type:feature' }, { name: 'prio:p1' }],
    body: 'Estimate: L',
  });

  assert.equal(props['GitHub Issue ID'].number, 77);
  assert.equal(props.Repo.select.name, 'kafkalm/Bossman');
  assert.equal(props.Priority.select.name, 'P1');
  assert.equal(props.Estimate.select.name, 'L');
  assert.equal(props['Work Type'].select.name, 'feature');
  assert.equal(props['GitHub Item Key'].rich_text[0].text.content, 'kafkalm/Bossman#77');
});
