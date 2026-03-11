import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWebhookEvent,
  normalizePolledEvent,
} from '../src/watcher/providers/github/GitHubNormalizer.js';

// Fixtures — structures match the real GitHub webhook payloads as documented at
// https://docs.github.com/en/webhooks/webhook-events-and-payloads
// Field shapes sourced from octokit/webhooks canonical payload examples.

// Reusable canonical user objects (GitHub user objects carry ~20 fields in real payloads)
const aliceUser = {
  login: 'alice',
  id: 1,
  node_id: 'MDQ6VXNlcjE=',
  avatar_url: 'https://github.com/images/error/alice_happy.gif',
  gravatar_id: '',
  url: 'https://api.github.com/users/alice',
  html_url: 'https://github.com/alice',
  followers_url: 'https://api.github.com/users/alice/followers',
  following_url: 'https://api.github.com/users/alice/following{/other_user}',
  gists_url: 'https://api.github.com/users/alice/gists{/gist_id}',
  starred_url: 'https://api.github.com/users/alice/starred{/owner}{/repo}',
  subscriptions_url: 'https://api.github.com/users/alice/subscriptions',
  organizations_url: 'https://api.github.com/users/alice/orgs',
  repos_url: 'https://api.github.com/users/alice/repos',
  events_url: 'https://api.github.com/users/alice/events{/privacy}',
  received_events_url: 'https://api.github.com/users/alice/received_events',
  type: 'User',
  site_admin: false,
};

const bobUser = {
  login: 'bob',
  id: 2,
  node_id: 'MDQ6VXNlcjI=',
  avatar_url: 'https://github.com/images/error/bob_happy.gif',
  gravatar_id: '',
  url: 'https://api.github.com/users/bob',
  html_url: 'https://github.com/bob',
  followers_url: 'https://api.github.com/users/bob/followers',
  following_url: 'https://api.github.com/users/bob/following{/other_user}',
  gists_url: 'https://api.github.com/users/bob/gists{/gist_id}',
  starred_url: 'https://api.github.com/users/bob/starred{/owner}{/repo}',
  subscriptions_url: 'https://api.github.com/users/bob/subscriptions',
  organizations_url: 'https://api.github.com/users/bob/orgs',
  repos_url: 'https://api.github.com/users/bob/repos',
  events_url: 'https://api.github.com/users/bob/events{/privacy}',
  received_events_url: 'https://api.github.com/users/bob/received_events',
  type: 'User',
  site_admin: false,
};

const charlieUser = {
  login: 'charlie',
  id: 3,
  node_id: 'MDQ6VXNlcjM=',
  avatar_url: 'https://github.com/images/error/charlie_happy.gif',
  gravatar_id: '',
  url: 'https://api.github.com/users/charlie',
  html_url: 'https://github.com/charlie',
  followers_url: 'https://api.github.com/users/charlie/followers',
  following_url: 'https://api.github.com/users/charlie/following{/other_user}',
  gists_url: 'https://api.github.com/users/charlie/gists{/gist_id}',
  starred_url: 'https://api.github.com/users/charlie/starred{/owner}{/repo}',
  subscriptions_url: 'https://api.github.com/users/charlie/subscriptions',
  organizations_url: 'https://api.github.com/users/charlie/orgs',
  repos_url: 'https://api.github.com/users/charlie/repos',
  events_url: 'https://api.github.com/users/charlie/events{/privacy}',
  received_events_url: 'https://api.github.com/users/charlie/received_events',
  type: 'User',
  site_admin: false,
};

const reviewerUser = {
  login: 'reviewer',
  id: 4,
  node_id: 'MDQ6VXNlcjQ=',
  avatar_url: 'https://github.com/images/error/reviewer_happy.gif',
  gravatar_id: '',
  url: 'https://api.github.com/users/reviewer',
  html_url: 'https://github.com/reviewer',
  followers_url: 'https://api.github.com/users/reviewer/followers',
  following_url: 'https://api.github.com/users/reviewer/following{/other_user}',
  gists_url: 'https://api.github.com/users/reviewer/gists{/gist_id}',
  starred_url: 'https://api.github.com/users/reviewer/starred{/owner}{/repo}',
  subscriptions_url: 'https://api.github.com/users/reviewer/subscriptions',
  organizations_url: 'https://api.github.com/users/reviewer/orgs',
  repos_url: 'https://api.github.com/users/reviewer/repos',
  events_url: 'https://api.github.com/users/reviewer/events{/privacy}',
  received_events_url: 'https://api.github.com/users/reviewer/received_events',
  type: 'User',
  site_admin: false,
};

// Canonical repository object (matches octokit/webhooks examples)
const repoObject = {
  id: 1296269,
  node_id: 'MDEwOlJlcG9zaXRvcnkxMjk2MjY5',
  name: 'repo',
  full_name: 'owner/repo',
  private: false,
  owner: aliceUser,
  html_url: 'https://github.com/owner/repo',
  description: null,
  fork: false,
  url: 'https://api.github.com/repos/owner/repo',
  forks_url: 'https://api.github.com/repos/owner/repo/forks',
  keys_url: 'https://api.github.com/repos/owner/repo/keys{/key_id}',
  created_at: '2019-05-15T15:19:25Z',
  updated_at: '2019-05-15T15:19:25Z',
  pushed_at: '2019-05-15T15:20:33Z',
  homepage: null,
  size: 0,
  stargazers_count: 0,
  watchers_count: 0,
  language: null,
  has_issues: true,
  has_projects: true,
  has_downloads: true,
  has_wiki: true,
  has_pages: false,
  forks_count: 0,
  open_issues_count: 1,
  default_branch: 'main',
  visibility: 'public',
};

const issueOpenedPayload = {
  action: 'opened',
  issue: {
    url: 'https://api.github.com/repos/owner/repo/issues/42',
    repository_url: 'https://api.github.com/repos/owner/repo',
    labels_url: 'https://api.github.com/repos/owner/repo/issues/42/labels{/name}',
    comments_url: 'https://api.github.com/repos/owner/repo/issues/42/comments',
    events_url: 'https://api.github.com/repos/owner/repo/issues/42/events',
    html_url: 'https://github.com/owner/repo/issues/42',
    id: 101,
    node_id: 'MDU6SXNzdWUxMDE=',
    number: 42,
    title: 'Fix login bug',
    user: aliceUser,
    labels: [],
    state: 'open',
    locked: false,
    assignee: null,
    assignees: [],
    milestone: null,
    comments: 0,
    created_at: '2019-05-15T15:20:18Z',
    updated_at: '2019-05-15T15:20:18Z',
    closed_at: null,
    author_association: 'OWNER',
    active_lock_reason: null,
    body: 'Login fails with SSO.',
    reactions: {
      url: 'https://api.github.com/repos/owner/repo/issues/42/reactions',
      total_count: 0,
      '+1': 0,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    draft: false,
  },
  repository: repoObject,
  sender: aliceUser,
};

const prOpenedPayload = {
  action: 'opened',
  // Real pull_request events also carry a top-level "number" field
  number: 7,
  pull_request: {
    url: 'https://api.github.com/repos/owner/repo/pulls/7',
    id: 201,
    node_id: 'MDExOlB1bGxSZXF1ZXN0MjAx',
    html_url: 'https://github.com/owner/repo/pull/7',
    diff_url: 'https://github.com/owner/repo/pull/7.diff',
    patch_url: 'https://github.com/owner/repo/pull/7.patch',
    issue_url: 'https://api.github.com/repos/owner/repo/issues/7',
    number: 7,
    state: 'open',
    locked: false,
    title: 'Add feature X',
    user: bobUser,
    body: 'This PR adds feature X.',
    created_at: '2019-05-15T15:20:33Z',
    updated_at: '2019-05-15T15:20:33Z',
    closed_at: null,
    merged_at: null,
    merge_commit_sha: null,
    assignee: null,
    assignees: [charlieUser],
    requested_reviewers: [],
    requested_teams: [],
    labels: [
      {
        id: 208045946,
        node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
        url: 'https://api.github.com/repos/owner/repo/labels/enhancement',
        name: 'enhancement',
        color: '84b6eb',
        default: false,
        description: 'New feature or request',
      },
    ],
    milestone: null,
    // head/base carry label, sha, user, and nested repo in real payloads
    head: {
      label: 'bob:feature/x',
      ref: 'feature/x',
      sha: 'abc1234567890',
      user: bobUser,
      repo: repoObject,
    },
    base: {
      label: 'owner:main',
      ref: 'main',
      sha: 'def9876543210',
      user: { login: 'owner', id: 5, node_id: 'MDQ6VXNlcjU=', type: 'User', site_admin: false },
      repo: repoObject,
    },
    author_association: 'OWNER',
    auto_merge: null,
    active_lock_reason: null,
    draft: false,
    merged: false,
    mergeable: null,
    rebaseable: null,
    mergeable_state: 'unknown',
    merged_by: null,
    comments: 0,
    review_comments: 0,
    maintainer_can_modify: false,
    commits: 1,
    additions: 1,
    deletions: 1,
    changed_files: 1,
  },
  repository: repoObject,
  sender: bobUser,
};

const issueCommentPayload = {
  action: 'created',
  issue: {
    url: 'https://api.github.com/repos/owner/repo/issues/42',
    repository_url: 'https://api.github.com/repos/owner/repo',
    labels_url: 'https://api.github.com/repos/owner/repo/issues/42/labels{/name}',
    comments_url: 'https://api.github.com/repos/owner/repo/issues/42/comments',
    events_url: 'https://api.github.com/repos/owner/repo/issues/42/events',
    html_url: 'https://github.com/owner/repo/issues/42',
    id: 101,
    node_id: 'MDU6SXNzdWUxMDE=',
    number: 42,
    title: 'Fix login bug',
    user: aliceUser,
    labels: [],
    state: 'open',
    locked: false,
    assignee: null,
    assignees: [],
    milestone: null,
    comments: 1,
    created_at: '2019-05-15T15:20:18Z',
    updated_at: '2019-05-15T15:20:33Z',
    closed_at: null,
    author_association: 'OWNER',
    active_lock_reason: null,
    body: 'Login fails with SSO.',
    reactions: {
      url: 'https://api.github.com/repos/owner/repo/issues/42/reactions',
      total_count: 0,
      '+1': 0,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    draft: false,
  },
  comment: {
    url: 'https://api.github.com/repos/owner/repo/issues/comments/999',
    html_url: 'https://github.com/owner/repo/issues/42#issuecomment-999',
    issue_url: 'https://api.github.com/repos/owner/repo/issues/42',
    id: 999,
    node_id: 'MDEyOklzc3VlQ29tbWVudDk5OQ==',
    user: reviewerUser,
    created_at: '2019-05-15T15:20:33Z',
    updated_at: '2019-05-15T15:20:33Z',
    author_association: 'CONTRIBUTOR',
    body: 'Can you provide more info?',
    reactions: {
      url: 'https://api.github.com/repos/owner/repo/issues/comments/999/reactions',
      total_count: 0,
      '+1': 0,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    performed_via_github_app: null,
  },
  repository: repoObject,
  sender: reviewerUser,
};

// For issue_comment on a PR: the issue object has a pull_request sub-field with
// url, html_url, diff_url, and patch_url (all four URL fields per the docs)
const prCommentPayload = {
  action: 'created',
  issue: {
    url: 'https://api.github.com/repos/owner/repo/issues/7',
    repository_url: 'https://api.github.com/repos/owner/repo',
    labels_url: 'https://api.github.com/repos/owner/repo/issues/7/labels{/name}',
    comments_url: 'https://api.github.com/repos/owner/repo/issues/7/comments',
    events_url: 'https://api.github.com/repos/owner/repo/issues/7/events',
    html_url: 'https://github.com/owner/repo/pull/7',
    id: 201,
    node_id: 'MDExOlB1bGxSZXF1ZXN0MjAx',
    number: 7,
    title: 'Add feature X',
    user: bobUser,
    labels: [],
    state: 'open',
    locked: false,
    assignee: null,
    assignees: [],
    milestone: null,
    comments: 1,
    created_at: '2019-05-15T15:20:33Z',
    updated_at: '2019-05-15T15:20:45Z',
    closed_at: null,
    author_association: 'OWNER',
    active_lock_reason: null,
    body: 'PR body',
    reactions: {
      url: 'https://api.github.com/repos/owner/repo/issues/7/reactions',
      total_count: 0,
      '+1': 0,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    draft: false,
    pull_request: {
      url: 'https://api.github.com/repos/owner/repo/pulls/7',
      html_url: 'https://github.com/owner/repo/pull/7',
      diff_url: 'https://github.com/owner/repo/pull/7.diff',
      patch_url: 'https://github.com/owner/repo/pull/7.patch',
    },
  },
  comment: {
    url: 'https://api.github.com/repos/owner/repo/issues/comments/888',
    html_url: 'https://github.com/owner/repo/pull/7#issuecomment-888',
    issue_url: 'https://api.github.com/repos/owner/repo/issues/7',
    id: 888,
    node_id: 'MDEyOklzc3VlQ29tbWVudDg4OA==',
    user: reviewerUser,
    created_at: '2019-05-15T15:20:45Z',
    updated_at: '2019-05-15T15:20:45Z',
    author_association: 'CONTRIBUTOR',
    body: 'LGTM!',
    reactions: {
      url: 'https://api.github.com/repos/owner/repo/issues/comments/888/reactions',
      total_count: 0,
      '+1': 0,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    performed_via_github_app: null,
  },
  repository: repoObject,
  sender: reviewerUser,
};

// --- normalizeWebhookEvent ---

test('normalizeWebhookEvent - issue opened', () => {
  const event = normalizeWebhookEvent(issueOpenedPayload as any, 'delivery-1');

  assert.equal(event.provider, 'github');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'opened');
  assert.equal(event.resource.number, 42);
  assert.equal(event.resource.title, 'Fix login bug');
  assert.equal(event.resource.description, 'Login fails with SSO.');
  assert.equal(event.resource.url, 'https://github.com/owner/repo/issues/42');
  assert.equal(event.resource.state, 'open');
  assert.equal(event.resource.repository, 'owner/repo');
  assert.equal(event.resource.author, 'alice');
  assert.equal(event.actor.username, 'alice');
  assert.equal(event.actor.id, 1);
  assert.equal(event.id, 'github:owner/repo:opened:101:delivery-1');
  assert.equal(event.metadata.deliveryId, 'delivery-1');
  assert.equal(event.resource.comment, undefined);
});

test('normalizeWebhookEvent - PR opened: extracts ref from nested head/base', () => {
  const event = normalizeWebhookEvent(prOpenedPayload as any, 'delivery-2');

  assert.equal(event.type, 'pull_request');
  assert.equal(event.action, 'opened');
  assert.equal(event.resource.number, 7);
  assert.equal(event.resource.title, 'Add feature X');
  // Labels: only the name is extracted even though real objects carry id/node_id/url/color/default/description
  assert.deepEqual(event.resource.labels, ['enhancement']);
  // Branch ref is read from head.ref (not head.label or head.sha)
  assert.equal(event.resource.branch, 'feature/x');
  assert.equal(event.resource.mergeTo, 'main');
  assert.equal(event.actor.username, 'bob');
  assert.ok(event.resource.assignees && event.resource.assignees.length === 1);
});

test('normalizeWebhookEvent - issue_comment on issue includes comment field', () => {
  const event = normalizeWebhookEvent(issueCommentPayload as any, 'delivery-3');

  assert.equal(event.type, 'issue');
  assert.equal(event.resource.comment?.body, 'Can you provide more info?');
  assert.equal(event.resource.comment?.author, 'reviewer');
  assert.equal(
    event.resource.comment?.url,
    'https://github.com/owner/repo/issues/42#issuecomment-999'
  );
  assert.equal(event.id, 'github:owner/repo:created:comment:999:delivery-3');
});

test('normalizeWebhookEvent - issue_comment on PR: issue.pull_request triggers pull_request type', () => {
  const event = normalizeWebhookEvent(prCommentPayload as any, 'delivery-4');

  // The presence of issue.pull_request (with all four URL fields) marks this as a PR event
  assert.equal(event.type, 'pull_request');
  assert.equal(event.resource.comment?.body, 'LGTM!');
  assert.equal(event.id, 'github:owner/repo:created:comment:888:delivery-4');
});

test('normalizeWebhookEvent - issue with no body uses empty string', () => {
  const payload = {
    ...issueOpenedPayload,
    issue: { ...issueOpenedPayload.issue, body: undefined },
  };
  const event = normalizeWebhookEvent(payload as any, 'delivery-5');
  assert.equal(event.resource.description, '');
});

test('normalizeWebhookEvent - issue with empty labels array has empty labels', () => {
  const event = normalizeWebhookEvent(issueOpenedPayload as any, 'delivery-6');
  assert.deepEqual(event.resource.labels, []);
});

test('normalizeWebhookEvent - sender info populates actor', () => {
  const event = normalizeWebhookEvent(issueCommentPayload as any, 'delivery-7');
  assert.equal(event.actor.username, 'reviewer');
  assert.equal(event.actor.id, 4);
});

test('normalizeWebhookEvent - metadata.timestamp is a valid ISO 8601 string', () => {
  // The template renders {{metadata.timestamp}} — verify it is always a non-empty ISO string
  const before = Date.now();
  const event = normalizeWebhookEvent(issueOpenedPayload as any, 'delivery-ts');
  const after = Date.now();
  assert.ok(typeof event.metadata.timestamp === 'string');
  const parsed = new Date(event.metadata.timestamp as string).getTime();
  assert.ok(!isNaN(parsed), 'timestamp should parse as a valid date');
  assert.ok(parsed >= before && parsed <= after, 'timestamp should be close to now');
});

test('normalizeWebhookEvent - issue with assignees: assignees field is truthy (controls template branching)', () => {
  // {{#if resource.assignees}} in the template branches into different instruction paths.
  // An issue (not just a PR) can have assignees.
  const payload = {
    ...issueOpenedPayload,
    issue: {
      ...issueOpenedPayload.issue,
      assignees: [
        { login: 'dev', id: 10, node_id: 'MDQ6VXNlcjEw', type: 'User', site_admin: false },
      ],
    },
  };
  const event = normalizeWebhookEvent(payload as any, 'delivery-assignees');
  assert.ok(event.resource.assignees && (event.resource.assignees as any[]).length === 1);
  assert.equal((event.resource.assignees as any[])[0].login, 'dev');
});

test('normalizeWebhookEvent - label objects with full canonical structure: only name is extracted', () => {
  // Real GitHub label objects have id, node_id, url, name, color, default, description.
  // The normalizer must extract only the name string from each.
  const payload = {
    ...issueOpenedPayload,
    issue: {
      ...issueOpenedPayload.issue,
      labels: [
        {
          id: 208045946,
          node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
          url: 'https://api.github.com/repos/owner/repo/labels/bug',
          name: 'bug',
          color: 'fc2929',
          default: true,
          description: 'Something broken',
        },
        {
          id: 208045947,
          node_id: 'MDU6TGFiZWwyMDgwNDU5NDc=',
          url: 'https://api.github.com/repos/owner/repo/labels/priority',
          name: 'priority',
          color: 'e4e669',
          default: false,
          description: '',
        },
      ],
    },
  };
  const event = normalizeWebhookEvent(payload as any, 'delivery-8');
  assert.deepEqual(event.resource.labels, ['bug', 'priority']);
});

// --- normalizePolledEvent ---

test('normalizePolledEvent - polled issue', () => {
  const item = {
    repository: 'owner/repo',
    type: 'issue',
    number: 42,
    data: {
      number: 42,
      title: 'Fix login bug',
      body: 'Login fails with SSO.',
      html_url: 'https://github.com/owner/repo/issues/42',
      state: 'open',
      user: aliceUser,
      assignees: [],
      labels: [
        {
          id: 208045946,
          node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
          url: 'https://api.github.com/repos/owner/repo/labels/bug',
          name: 'bug',
          color: 'fc2929',
          default: true,
          description: 'Something broken',
        },
      ],
    },
  };

  const before = Date.now();
  const event = normalizePolledEvent(item);
  const after = Date.now();

  assert.equal(event.provider, 'github');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'poll');
  assert.equal(event.resource.number, 42);
  assert.equal(event.resource.repository, 'owner/repo');
  assert.deepEqual(event.resource.labels, ['bug']);
  assert.equal(event.metadata.polled, true);
  assert.ok(event.id.startsWith('github:owner/repo:poll:42:'));
  assert.equal(event.actor.username, 'alice');
  assert.equal(event.actor.id, 1);
  // metadata.timestamp must be a valid ISO string (used by {{metadata.timestamp}} in the template)
  const parsed = new Date(event.metadata.timestamp as string).getTime();
  assert.ok(!isNaN(parsed) && parsed >= before && parsed <= after);
});

test('normalizePolledEvent - polled PR: ref extracted from nested head/base objects', () => {
  const item = {
    repository: 'owner/repo',
    type: 'pull_request',
    number: 7,
    data: {
      number: 7,
      title: 'Add feature X',
      body: 'PR body',
      html_url: 'https://github.com/owner/repo/pull/7',
      state: 'open',
      user: bobUser,
      assignees: [],
      labels: [],
      head: { label: 'bob:feature/x', ref: 'feature/x', sha: 'abc1234' },
      base: { label: 'owner:main', ref: 'main', sha: 'def5678' },
    },
  };

  const event = normalizePolledEvent(item);

  assert.equal(event.type, 'pull_request');
  assert.equal(event.action, 'poll');
  assert.equal(event.resource.branch, 'feature/x');
  assert.equal(event.resource.mergeTo, 'main');
});

test('normalizePolledEvent - issue with no body uses empty string', () => {
  const item = {
    repository: 'owner/repo',
    type: 'issue',
    number: 1,
    data: {
      number: 1,
      title: 'Test',
      html_url: 'https://github.com/owner/repo/issues/1',
      state: 'open',
      user: { login: 'alice', id: 1, type: 'User', site_admin: false },
      assignees: [],
      labels: [],
    },
  };

  const event = normalizePolledEvent(item);
  assert.equal(event.resource.description, '');
});
