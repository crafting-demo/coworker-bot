/**
 * Integration tests for GitHubProvider.
 *
 * Tests the provider's event admission logic after full initialization:
 * triggerLabels, watchChecks, and shouldProcessEvent filtering.
 * Uses mocked fetch to simulate GitHub API responses during initialization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProvider } from '../../../src/watcher/providers/github/GitHubProvider.js';
import type { NormalizedEvent, ProviderConfig } from '../../../src/watcher/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheckFailedEvent(overrides: {
  labels?: string[];
  assignees?: Array<{ login: string }>;
  state?: string;
}): NormalizedEvent {
  return {
    id: 'github:owner/repo:status:1:del-1',
    provider: 'github',
    type: 'pull_request',
    action: 'check_failed',
    resource: {
      number: 10,
      title: 'PR',
      description: '',
      url: 'https://github.com/owner/repo/pull/10',
      state: overrides.state ?? 'open',
      repository: 'owner/repo',
      branch: 'feature/x',
      mergeTo: 'main',
      labels: overrides.labels,
      assignees: overrides.assignees,
      check: {
        name: 'buildkite/repo',
        conclusion: 'failure',
        url: 'https://buildkite.com/build/1',
      },
    },
    actor: { username: 'buildkite[bot]', id: 1 },
    metadata: { timestamp: new Date().toISOString() },
    raw: {},
  } as unknown as NormalizedEvent;
}

function makeIssueEvent(overrides: {
  labels?: string[];
  assignees?: Array<{ login: string }>;
  comment?: { body: string; author: string };
  state?: string;
}): NormalizedEvent {
  return {
    id: 'github:owner/repo:opened:42:del-1',
    provider: 'github',
    type: 'issue',
    action: 'opened',
    resource: {
      number: 42,
      title: 'Issue',
      description: '',
      url: 'https://github.com/owner/repo/issues/42',
      state: overrides.state ?? 'open',
      repository: 'owner/repo',
      labels: overrides.labels,
      assignees: overrides.assignees,
      comment: overrides.comment,
    },
    actor: { username: 'alice', id: 1 },
    metadata: { timestamp: new Date().toISOString() },
    raw: {},
  } as unknown as NormalizedEvent;
}

// Subclass that exposes the private shouldProcessEvent for testing
class TestableProvider extends GitHubProvider {
  callShouldProcessEvent(
    event: NormalizedEvent,
    hasRecentComments?: boolean,
    actions?: string[],
    skipActions?: string[]
  ): boolean {
    return (this as any).shouldProcessEvent(event, hasRecentComments, actions, skipActions);
  }
}

async function makeProvider(options: Record<string, unknown>): Promise<TestableProvider> {
  const orig = global.fetch;
  global.fetch = async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({ login: 'bot-user' }),
    }) as unknown as Response;

  const provider = new TestableProvider();
  const config: ProviderConfig = {
    enabled: true,
    auth: { type: 'token', token: 'fake-token' },
    options,
  };
  await provider.initialize(config);
  global.fetch = orig;
  return provider;
}

// ---------------------------------------------------------------------------
// triggerLabels — shouldProcessEvent bypass
// ---------------------------------------------------------------------------

test('shouldProcessEvent - triggerLabels: issue with matching label bypasses assignment check', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', triggerLabels: ['coworker'] });
  assert.equal(
    provider.callShouldProcessEvent(makeIssueEvent({ labels: ['coworker'], assignees: [] })),
    true
  );
});

test('shouldProcessEvent - triggerLabels: case-insensitive label match', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', triggerLabels: ['Coworker'] });
  assert.equal(
    provider.callShouldProcessEvent(makeIssueEvent({ labels: ['coworker'], assignees: [] })),
    true
  );
});

test('shouldProcessEvent - triggerLabels: non-matching label falls through to assignment check', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', triggerLabels: ['coworker'] });
  // bot not assigned → skipped
  assert.equal(
    provider.callShouldProcessEvent(makeIssueEvent({ labels: ['bug'], assignees: [] })),
    false
  );
});

test('shouldProcessEvent - triggerLabels: no labels falls through to assignment check', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', triggerLabels: ['coworker'] });
  assert.equal(
    provider.callShouldProcessEvent(makeIssueEvent({ labels: undefined, assignees: [] })),
    false
  );
});

test('shouldProcessEvent - triggerLabels not configured: assignment check applies', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user' });
  // label present but triggerLabels not configured → bot not assigned → skipped
  assert.equal(
    provider.callShouldProcessEvent(makeIssueEvent({ labels: ['coworker'], assignees: [] })),
    false
  );
});

test('shouldProcessEvent - bot-authored comment skipped even when triggerLabels matches', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', triggerLabels: ['coworker'] });
  const event = makeIssueEvent({
    labels: ['coworker'],
    assignees: [],
    comment: { body: 'Agent is working on it', author: 'bot-user' },
  });
  assert.equal(provider.callShouldProcessEvent(event), false);
});

// ---------------------------------------------------------------------------
// watchChecks — check_failed admission
// ---------------------------------------------------------------------------

test('shouldProcessEvent - watchChecks=true: check failure admitted', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', watchChecks: true });
  assert.equal(
    provider.callShouldProcessEvent(makeCheckFailedEvent({ labels: [], assignees: [] })),
    true
  );
});

test('shouldProcessEvent - watchChecks=false, no trigger label: check failure skipped', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user' });
  assert.equal(
    provider.callShouldProcessEvent(makeCheckFailedEvent({ labels: [], assignees: [] })),
    false
  );
});

test('shouldProcessEvent - watchChecks=false, trigger label matches: check failure admitted', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', triggerLabels: ['coworker'] });
  assert.equal(
    provider.callShouldProcessEvent(makeCheckFailedEvent({ labels: ['coworker'], assignees: [] })),
    true
  );
});

test('shouldProcessEvent - check failure on closed PR is skipped', async () => {
  const provider = await makeProvider({ botUsername: 'bot-user', watchChecks: true });
  assert.equal(provider.callShouldProcessEvent(makeCheckFailedEvent({ state: 'closed' })), false);
});
