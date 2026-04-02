import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubComments } from '../../../src/watcher/providers/github/GitHubComments.js';

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
// getAuthenticatedUser() — PAT vs App mode
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
// getAccessibleRepositories() — GitHub App mode
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
// getPullRequestsForCommit()
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
// getPullRequest() — extended fields
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
