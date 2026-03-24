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
// GitHubComments.getAuthenticatedUser() — PAT mode auto-detection
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
