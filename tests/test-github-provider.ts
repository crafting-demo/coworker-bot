/**
 * Tests covering GitHub provider behavior for both auth modes:
 *
 * Mode 1 — GitHub App:
 *   - Token injected automatically by the mcp-proxy (GITHUB_ORG env var set)
 *   - botUsername must be configured explicitly (installation tokens cannot call GET /user)
 *   - botUsername follows the "<app-name>[bot]" pattern
 *   - Repositories auto-detected via GET /installation/repositories
 *   - Users often omit "[bot]" suffix when @mentioning App bots
 *
 * Mode 2 — PAT / bot user:
 *   - Token from watcher.yaml auth.tokenEnv (e.g. GITHUB_TOKEN)
 *   - botUsername auto-detected via GET /user
 *   - Repositories must be explicitly configured (App-only endpoint not available)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBotMentionedInText, isBotAssignedInList } from '../src/watcher/utils/eventFilter.js';
import { GitHubComments } from '../src/watcher/providers/github/GitHubComments.js';

// ---------------------------------------------------------------------------
// isBotMentionedInText — PAT mode (plain username, no "[bot]" suffix)
// ---------------------------------------------------------------------------

test('isBotMentionedInText - PAT mode: matches @mention by plain username', () => {
  assert.equal(isBotMentionedInText('@coworker-bot please fix this', ['coworker-bot']), true);
});

test('isBotMentionedInText - PAT mode: case-insensitive match', () => {
  assert.equal(isBotMentionedInText('@Coworker-Bot do this', ['coworker-bot']), true);
});

test('isBotMentionedInText - PAT mode: no match when bot not mentioned', () => {
  assert.equal(isBotMentionedInText('please fix the bug', ['coworker-bot']), false);
});

test('isBotMentionedInText - PAT mode: no match for different username', () => {
  assert.equal(isBotMentionedInText('@other-bot do this', ['coworker-bot']), false);
});

test('isBotMentionedInText - PAT mode: word-boundary prevents partial match', () => {
  // @coworker-bot-extra should not match coworker-bot
  assert.equal(isBotMentionedInText('@coworker-bot-extra fix', ['coworker-bot']), false);
});

test('isBotMentionedInText - PAT mode: matches when mention is mid-sentence', () => {
  assert.equal(
    isBotMentionedInText('hey @coworker-bot, can you look at this?', ['coworker-bot']),
    true
  );
});

// ---------------------------------------------------------------------------
// isBotMentionedInText — GitHub App mode ("<name>[bot]" username)
// ---------------------------------------------------------------------------

test('isBotMentionedInText - App mode: matches full @mention including [bot] suffix', () => {
  assert.equal(isBotMentionedInText('@my-app[bot] fix this', ['my-app[bot]']), true);
});

test('isBotMentionedInText - App mode: matches bare @mention without [bot] suffix', () => {
  // Users commonly type @my-app instead of @my-app[bot] — both must match
  assert.equal(isBotMentionedInText('@my-app fix this', ['my-app[bot]']), true);
});

test('isBotMentionedInText - App mode: bare match is case-insensitive', () => {
  assert.equal(isBotMentionedInText('@My-App please do it', ['my-app[bot]']), true);
});

test('isBotMentionedInText - App mode: no match when different bot mentioned', () => {
  assert.equal(isBotMentionedInText('@other-app[bot] fix this', ['my-app[bot]']), false);
});

test('isBotMentionedInText - App mode: word-boundary prevents partial match on bare name', () => {
  // @my-app-extra should not match my-app[bot]
  assert.equal(isBotMentionedInText('@my-app-extra fix this', ['my-app[bot]']), false);
});

test('isBotMentionedInText - App mode: no match when no @ prefix', () => {
  assert.equal(isBotMentionedInText('my-app please fix this', ['my-app[bot]']), false);
});

test('isBotMentionedInText - multiple bots: matches any in the list', () => {
  assert.equal(isBotMentionedInText('@backup-bot help', ['my-app[bot]', 'backup-bot']), true);
});

test('isBotMentionedInText - empty text returns false', () => {
  assert.equal(isBotMentionedInText('', ['coworker-bot']), false);
});

test('isBotMentionedInText - empty bot list returns false', () => {
  assert.equal(isBotMentionedInText('@coworker-bot fix', []), false);
});

// ---------------------------------------------------------------------------
// isBotAssignedInList — both modes
// ---------------------------------------------------------------------------

test('isBotAssignedInList - PAT mode: matches plain bot username in assignees', () => {
  const assignees = [{ login: 'coworker-bot' }];
  assert.equal(
    isBotAssignedInList(assignees, ['coworker-bot'], (a) => (a as { login: string }).login),
    true
  );
});

test('isBotAssignedInList - App mode: matches "[bot]" username in assignees', () => {
  const assignees = [{ login: 'my-app[bot]' }];
  assert.equal(
    isBotAssignedInList(assignees, ['my-app[bot]'], (a) => (a as { login: string }).login),
    true
  );
});

test('isBotAssignedInList - case-insensitive match', () => {
  const assignees = [{ login: 'Coworker-Bot' }];
  assert.equal(
    isBotAssignedInList(assignees, ['coworker-bot'], (a) => (a as { login: string }).login),
    true
  );
});

test('isBotAssignedInList - returns false when bot not in assignees', () => {
  const assignees = [{ login: 'alice' }];
  assert.equal(
    isBotAssignedInList(assignees, ['coworker-bot'], (a) => (a as { login: string }).login),
    false
  );
});

test('isBotAssignedInList - returns false for empty assignees', () => {
  assert.equal(
    isBotAssignedInList([], ['coworker-bot'], (a) => (a as { login: string }).login),
    false
  );
});

test('isBotAssignedInList - returns false for undefined assignees', () => {
  assert.equal(
    isBotAssignedInList(undefined, ['coworker-bot'], (a) => (a as { login: string }).login),
    false
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  const orig = global.fetch;
  global.fetch = async () =>
    ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 403),
      statusText: response.ok ? 'OK' : 'Forbidden',
      headers: { get: () => null },
      json: response.json ?? (() => Promise.resolve({})),
    }) as unknown as Response;
  return () => {
    global.fetch = orig;
  };
}

// ---------------------------------------------------------------------------
// GitHubComments.getAuthenticatedUser() — PAT mode auto-detection
// ---------------------------------------------------------------------------

test('GitHubComments.getAuthenticatedUser - PAT mode: returns login from GET /user', async () => {
  const restore = mockFetch({
    ok: true,
    json: () => Promise.resolve({ login: 'coworker-bot' }),
  });
  try {
    const comments = new GitHubComments(() => 'fake-pat');
    const user = await comments.getAuthenticatedUser();
    assert.equal(user, 'coworker-bot');
  } finally {
    restore();
  }
});

test('GitHubComments.getAuthenticatedUser - App mode: returns null on 403 (installation tokens cannot call GET /user)', async () => {
  const restore = mockFetch({ ok: false, status: 403 });
  try {
    const comments = new GitHubComments(() => 'ghs_installation_token');
    const user = await comments.getAuthenticatedUser();
    assert.equal(user, null);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// GitHubComments.getAccessibleRepositories() — GitHub App mode
// ---------------------------------------------------------------------------

test('GitHubComments.getAccessibleRepositories - App mode: returns repos from installation API', async () => {
  const restore = mockFetch({
    ok: true,
    json: () =>
      Promise.resolve({
        total_count: 2,
        repositories: [{ full_name: 'myorg/repo-a' }, { full_name: 'myorg/repo-b' }],
      }),
  });
  try {
    const comments = new GitHubComments(() => 'ghs_installation_token');
    const repos = await comments.getAccessibleRepositories();
    assert.deepEqual(repos, ['myorg/repo-a', 'myorg/repo-b']);
  } finally {
    restore();
  }
});

test('GitHubComments.getAccessibleRepositories - PAT mode: returns empty array on non-ok response', async () => {
  // GET /installation/repositories returns 404 for PATs — endpoint is App-only
  const restore = mockFetch({ ok: false, status: 404 });
  try {
    const comments = new GitHubComments(() => 'fake-pat');
    const repos = await comments.getAccessibleRepositories();
    assert.deepEqual(repos, []);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// GitHubComments.getPullRequestsForCommit()
// ---------------------------------------------------------------------------

test('GitHubComments.getPullRequestsForCommit - returns open PRs for the commit SHA', async () => {
  const restore = mockFetch({
    ok: true,
    json: () =>
      Promise.resolve([
        { number: 64, state: 'open', head: { ref: 'ai/issue-63' }, base: { ref: 'main' } },
        { number: 65, state: 'open', head: { ref: 'ai/issue-64' }, base: { ref: 'main' } },
      ]),
  });
  try {
    const comments = new GitHubComments(() => 'fake-token');
    const prs = await comments.getPullRequestsForCommit('owner/repo', 'abc123');
    assert.equal(prs.length, 2);
    assert.equal(prs[0]!.number, 64);
    assert.equal(prs[1]!.number, 65);
  } finally {
    restore();
  }
});

test('GitHubComments.getPullRequestsForCommit - filters out closed/merged PRs', async () => {
  const restore = mockFetch({
    ok: true,
    json: () =>
      Promise.resolve([
        { number: 64, state: 'open', head: { ref: 'ai/issue-63' }, base: { ref: 'main' } },
        { number: 60, state: 'closed', head: { ref: 'old-branch' }, base: { ref: 'main' } },
      ]),
  });
  try {
    const comments = new GitHubComments(() => 'fake-token');
    const prs = await comments.getPullRequestsForCommit('owner/repo', 'abc123');
    assert.equal(prs.length, 1);
    assert.equal(prs[0]!.number, 64);
  } finally {
    restore();
  }
});

test('GitHubComments.getPullRequestsForCommit - returns empty array on API error', async () => {
  const restore = mockFetch({ ok: false, status: 422 });
  try {
    const comments = new GitHubComments(() => 'fake-token');
    const prs = await comments.getPullRequestsForCommit('owner/repo', 'abc123');
    assert.deepEqual(prs, []);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// GitHubComments.getPullRequest() — extended fields
// ---------------------------------------------------------------------------

test('GitHubComments.getPullRequest - returns full PR details including title, labels, author', async () => {
  const restore = mockFetch({
    ok: true,
    json: () =>
      Promise.resolve({
        title: 'Add feature X',
        body: 'PR body',
        html_url: 'https://github.com/owner/repo/pull/7',
        state: 'open',
        head: { ref: 'feature/x' },
        base: { ref: 'main' },
        user: { login: 'alice' },
        labels: [{ name: 'bug' }, { name: 'coworker' }],
      }),
  });
  try {
    const comments = new GitHubComments(() => 'fake-token');
    const pr = await comments.getPullRequest('owner/repo', 7);
    assert.ok(pr !== null);
    assert.equal(pr!.title, 'Add feature X');
    assert.equal(pr!.description, 'PR body');
    assert.equal(pr!.url, 'https://github.com/owner/repo/pull/7');
    assert.equal(pr!.state, 'open');
    assert.equal(pr!.branch, 'feature/x');
    assert.equal(pr!.mergeTo, 'main');
    assert.equal(pr!.author, 'alice');
    assert.deepEqual(pr!.labels, ['bug', 'coworker']);
  } finally {
    restore();
  }
});

test('GitHubComments.getPullRequest - handles missing body as empty string', async () => {
  const restore = mockFetch({
    ok: true,
    json: () =>
      Promise.resolve({
        title: 'No body PR',
        body: null,
        html_url: 'https://github.com/owner/repo/pull/8',
        state: 'open',
        head: { ref: 'fix/something' },
        base: { ref: 'main' },
        user: { login: 'bob' },
        labels: [],
      }),
  });
  try {
    const comments = new GitHubComments(() => 'fake-token');
    const pr = await comments.getPullRequest('owner/repo', 8);
    assert.equal(pr!.description, '');
    assert.equal(pr!.author, 'bob');
    assert.deepEqual(pr!.labels, undefined);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// triggerLabels — shouldProcessEvent bypass
// ---------------------------------------------------------------------------

import { GitHubProvider } from '../src/watcher/providers/github/GitHubProvider.js';
import type { NormalizedEvent, ProviderConfig } from '../src/watcher/types/index.js';

function makeCheckFailedEvent(overrides: {
  labels?: string[];
  assignees?: Array<{ login: string }>;
  state?: string;
}) {
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
  };
}

function makeIssueEvent(overrides: {
  labels?: string[];
  assignees?: Array<{ login: string }>;
  comment?: { body: string; author: string };
  state?: string;
}) {
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
  };
}

// Access shouldProcessEvent via a subclass that exposes it for testing
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

async function makeTestableProvider(options: Record<string, unknown>): Promise<TestableProvider> {
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

test('shouldProcessEvent - triggerLabels: issue with matching label bypasses assignment check', async () => {
  const provider = await makeTestableProvider({
    botUsername: 'bot-user',
    triggerLabels: ['coworker'],
  });
  const event = makeIssueEvent({ labels: ['coworker'], assignees: [] });
  assert.equal(provider.callShouldProcessEvent(event), true);
});

test('shouldProcessEvent - triggerLabels: case-insensitive label match', async () => {
  const provider = await makeTestableProvider({
    botUsername: 'bot-user',
    triggerLabels: ['Coworker'],
  });
  const event = makeIssueEvent({ labels: ['coworker'], assignees: [] });
  assert.equal(provider.callShouldProcessEvent(event), true);
});

test('shouldProcessEvent - triggerLabels: no matching label falls through to assignment check', async () => {
  const provider = await makeTestableProvider({
    botUsername: 'bot-user',
    triggerLabels: ['coworker'],
  });
  const event = makeIssueEvent({ labels: ['bug'], assignees: [] });
  // bot not assigned → should be skipped
  assert.equal(provider.callShouldProcessEvent(event), false);
});

test('shouldProcessEvent - triggerLabels: no labels on issue falls through to assignment check', async () => {
  const provider = await makeTestableProvider({
    botUsername: 'bot-user',
    triggerLabels: ['coworker'],
  });
  const event = makeIssueEvent({ labels: undefined, assignees: [] });
  assert.equal(provider.callShouldProcessEvent(event), false);
});

test('shouldProcessEvent - triggerLabels not configured: original assignment check applies', async () => {
  const provider = await makeTestableProvider({ botUsername: 'bot-user' });
  const event = makeIssueEvent({ labels: ['coworker'], assignees: [] });
  // label present but triggerLabels not configured → assignment check applies → bot not assigned → skip
  assert.equal(provider.callShouldProcessEvent(event), false);
});

test('shouldProcessEvent - bot-authored comment skipped even when triggerLabels matches', async () => {
  const provider = await makeTestableProvider({
    botUsername: 'bot-user',
    triggerLabels: ['coworker'],
  });
  const event = makeIssueEvent({
    labels: ['coworker'],
    assignees: [],
    comment: { body: 'Agent is working on it', author: 'bot-user' },
  });
  // Trigger label matches, but bot wrote the comment → must still be skipped
  assert.equal(provider.callShouldProcessEvent(event), false);
});

// ---------------------------------------------------------------------------
// watchChecks — check_failed admission
// ---------------------------------------------------------------------------

test('shouldProcessEvent - watchChecks=true: check failure admitted', async () => {
  const provider = await makeTestableProvider({ botUsername: 'bot-user', watchChecks: true });
  const event = makeCheckFailedEvent({ labels: [], assignees: [] });
  assert.equal(provider.callShouldProcessEvent(event), true);
});

test('shouldProcessEvent - watchChecks=false, no trigger label: check failure skipped', async () => {
  const provider = await makeTestableProvider({ botUsername: 'bot-user' });
  const event = makeCheckFailedEvent({ labels: [], assignees: [] });
  assert.equal(provider.callShouldProcessEvent(event), false);
});

test('shouldProcessEvent - watchChecks=false, trigger label matches: check failure admitted', async () => {
  const provider = await makeTestableProvider({
    botUsername: 'bot-user',
    triggerLabels: ['coworker'],
  });
  const event = makeCheckFailedEvent({ labels: ['coworker'], assignees: [] });
  assert.equal(provider.callShouldProcessEvent(event), true);
});

test('shouldProcessEvent - check failure on closed PR is skipped', async () => {
  const provider = await makeTestableProvider({ botUsername: 'bot-user', watchChecks: true });
  const event = makeCheckFailedEvent({ state: 'closed' });
  assert.equal(provider.callShouldProcessEvent(event), false);
});
