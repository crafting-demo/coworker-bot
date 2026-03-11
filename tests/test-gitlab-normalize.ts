import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWebhookEvent,
  normalizePolledEvent,
} from '../src/watcher/providers/gitlab/GitLabNormalizer.js';

// Fixtures — structures match real GitLab webhook payloads as documented at
// https://docs.gitlab.com/user/project/integrations/webhook_events/
//
// Key structural notes from the docs:
//   - Top-level "user" is who triggered the event
//   - Top-level "assignees" (array) and "assignee" (singular) are present for issue/MR events
//   - Top-level "labels" mirrors object_attributes.labels
//   - Note events: object_attributes has "note" + "url" (to the note); the parent
//     resource lives in a sibling "issue" or "merge_request" field
//   - Label objects have: id, title, color, project_id, created_at, updated_at,
//     template, description, type ("ProjectLabel"|"GroupLabel"), group_id
//   - User objects have: id, name, username, avatar_url, email
//   - Project object has: id, name, description, web_url, avatar_url, git_ssh_url,
//     git_http_url, namespace, visibility_level, path_with_namespace, default_branch,
//     ci_config_path, homepage, url, ssh_url, http_url

// Shared fixtures
const projectObject = {
  id: 5,
  name: 'Gitlab Test',
  description: 'Aut reprehenderit ut est.',
  web_url: 'http://example.com/gitlab-org/gitlab-test',
  avatar_url: null,
  git_ssh_url: 'git@example.com:gitlab-org/gitlab-test.git',
  git_http_url: 'http://example.com/gitlab-org/gitlab-test.git',
  namespace: 'Gitlab Org',
  visibility_level: 10,
  path_with_namespace: 'gitlab-org/gitlab-test',
  default_branch: 'master',
  ci_config_path: null,
  homepage: 'http://example.com/gitlab-org/gitlab-test',
  url: 'http://example.com/gitlab-org/gitlab-test.git',
  ssh_url: 'git@example.com:gitlab-org/gitlab-test.git',
  http_url: 'http://example.com/gitlab-org/gitlab-test.git',
};

const adminUser = {
  id: 1,
  name: 'Administrator',
  username: 'root',
  avatar_url: 'http://www.gravatar.com/avatar/e64c7d89f26bd1972efa854d13d7dd61',
  email: 'admin@example.com',
};

const user1Assignee = {
  id: 51,
  name: 'User1',
  username: 'user1',
  avatar_url: 'http://www.gravatar.com/avatar/user1',
  email: 'user1@example.com',
};

const bugLabel = {
  id: 206,
  title: 'API',
  color: '#ffffff',
  project_id: 14,
  created_at: '2013-12-03T17:15:43Z',
  updated_at: '2013-12-03T17:15:43Z',
  template: false,
  description: 'API related issues',
  type: 'ProjectLabel',
  group_id: null,
};

const issueOpenedPayload = {
  object_kind: 'issue',
  event_type: 'issue',
  user: adminUser,
  project: projectObject,
  repository: {
    name: 'Gitlab Test',
    url: 'http://example.com/gitlab-org/gitlab-test.git',
    description: 'Aut reprehenderit ut est.',
    homepage: 'http://example.com/gitlab-org/gitlab-test',
  },
  object_attributes: {
    id: 301,
    iid: 23,
    title: 'New API: create/update/delete file',
    description: 'Create new API for manipulations with repository',
    url: 'http://example.com/diaspora/issues/23',
    state: 'opened',
    action: 'open',
    author_id: 51,
    assignee_ids: [51],
    assignee_id: 51,
    project_id: 14,
    created_at: '2013-12-03T17:15:43Z',
    updated_at: '2013-12-03T17:15:43Z',
    updated_by_id: 1,
    milestone_id: null,
    confidential: false,
    discussion_locked: false,
    due_date: null,
    labels: [bugLabel],
  },
  assignees: [user1Assignee],
  assignee: user1Assignee,
  labels: [bugLabel],
  changes: {},
};

const mrOpenedPayload = {
  object_kind: 'merge_request',
  event_type: 'merge_request',
  user: adminUser,
  project: projectObject,
  repository: {
    name: 'Gitlab Test',
    url: 'http://example.com/gitlab-org/gitlab-test.git',
    description: 'Aut reprehenderit ut est.',
    homepage: 'http://example.com/gitlab-org/gitlab-test',
  },
  object_attributes: {
    id: 93,
    iid: 16,
    title: 'Add input validation to booking form',
    description: 'This merge request adds input validation to the booking form.',
    url: 'http://example.com/gitlab-org/gitlab-test/-/merge_requests/16',
    state: 'opened',
    action: 'open',
    author_id: 1,
    assignee_ids: [1],
    source_branch: 'feature/booking-validation',
    target_branch: 'main',
    source_project_id: 5,
    target_project_id: 5,
    created_at: '2026-01-16T05:56:22Z',
    updated_at: '2026-01-16T05:56:25Z',
    merge_status: 'checking',
    draft: false,
    labels: [
      {
        id: 19,
        title: 'enhancement',
        color: '#adb21a',
        project_id: null,
        created_at: '2026-01-07T00:03:52Z',
        updated_at: '2026-01-07T00:03:52Z',
        template: false,
        description: null,
        type: 'GroupLabel',
        group_id: 24,
      },
    ],
    last_commit: {
      id: 'e59094b8de0f2f91abbe4760a52d9137260252d8',
      message: 'Add email format validation',
      title: 'Add email format validation',
      timestamp: '2026-01-16T05:01:10+00:00',
      url: 'http://example.com/gitlab-org/gitlab-test/-/commit/e59094b8de0f2f91abbe4760a52d9137260252d8',
      author: { name: 'Administrator', email: 'admin@example.com' },
    },
  },
  assignees: [user1Assignee],
  labels: [
    {
      id: 19,
      title: 'enhancement',
      color: '#adb21a',
      project_id: null,
      created_at: '2026-01-07T00:03:52Z',
      updated_at: '2026-01-07T00:03:52Z',
      template: false,
      description: null,
      type: 'GroupLabel',
      group_id: 24,
    },
  ],
  changes: {},
};

const noteOnIssuePayload = {
  object_kind: 'note',
  event_type: 'note',
  user: adminUser,
  project_id: 5,
  project: projectObject,
  repository: {
    name: 'diaspora',
    url: 'git@example.com:mike/diaspora.git',
    description: '',
    homepage: 'http://example.com/mike/diaspora',
  },
  object_attributes: {
    id: 1241,
    internal: false,
    note: 'Hello world',
    noteable_type: 'Issue',
    author_id: 1,
    created_at: '2015-05-17T17:06:40Z',
    updated_at: '2015-05-17T17:06:40Z',
    project_id: 5,
    attachment: null,
    line_code: null,
    commit_id: '',
    noteable_id: 92,
    system: false,
    st_diff: null,
    action: 'create',
    url: 'http://example.com/gitlab-org/gitlab-test/issues/17#note_1241',
  },
  issue: {
    id: 92,
    iid: 17,
    title: 'test',
    description: 'test issue body',
    state: 'closed',
    assignee_ids: [],
    assignee_id: null,
    author_id: 1,
    project_id: 5,
    created_at: '2015-04-12T14:53:17Z',
    updated_at: '2015-04-26T08:28:42Z',
    labels: [
      {
        id: 25,
        title: 'Afterpod',
        color: '#3e8068',
        project_id: null,
        created_at: '2019-06-05T14:32:20.211Z',
        updated_at: '2019-06-05T14:32:20.211Z',
        template: false,
        description: null,
        type: 'GroupLabel',
        group_id: 4,
      },
    ],
  },
};

const noteOnMRPayload = {
  object_kind: 'note',
  event_type: 'note',
  user: adminUser,
  project_id: 5,
  project: projectObject,
  repository: {
    name: 'Gitlab Test',
    url: 'http://localhost/gitlab-org/gitlab-test.git',
    description: 'Aut reprehenderit ut est.',
    homepage: 'http://example.com/gitlab-org/gitlab-test',
  },
  object_attributes: {
    id: 1244,
    internal: false,
    note: 'This MR needs work.',
    noteable_type: 'MergeRequest',
    author_id: 1,
    created_at: '2015-05-17T18:21:36Z',
    updated_at: '2015-05-17T18:21:36Z',
    project_id: 5,
    attachment: null,
    line_code: null,
    commit_id: '',
    noteable_id: 7,
    system: false,
    st_diff: null,
    action: 'create',
    url: 'http://example.com/gitlab-org/gitlab-test/merge_requests/1#note_1244',
  },
  merge_request: {
    id: 7,
    iid: 1,
    title: 'Tempora et eos debitis quae laborum et.',
    description: 'Et voluptas corrupti assumenda temporibus.',
    state: 'opened',
    source_branch: 'master',
    target_branch: 'markdown',
    source_project_id: 5,
    target_project_id: 5,
    author_id: 8,
    assignee_id: 28,
    merge_status: 'cannot_be_merged',
    labels: [
      {
        id: 86,
        title: 'Element',
        color: '#231afe',
        project_id: 4,
        created_at: '2019-06-05T14:32:20.637Z',
        updated_at: '2019-06-05T14:32:20.637Z',
        template: false,
        description: null,
        type: 'ProjectLabel',
        group_id: null,
      },
    ],
    assignee: {
      id: 28,
      name: 'User1',
      username: 'user1',
      avatar_url: 'http://www.gravatar.com/avatar/...',
    },
    last_commit: {
      id: '562e173be03b8ff2efb05345d12df18815438a4b',
      message: "Merge branch 'another-branch' into 'master'",
      timestamp: '2015-04-08T21:00:25-07:00',
      url: 'http://example.com/gitlab-org/gitlab-test/commit/562e173be03b8ff2efb05345d12df18815438a4b',
      author: { name: 'John Smith', email: 'john@example.com' },
    },
    draft: false,
    detailed_merge_status: 'checking',
  },
};

// --- normalizeWebhookEvent: issue ---

test('normalizeWebhookEvent - issue opened', () => {
  const event = normalizeWebhookEvent(issueOpenedPayload as any);

  assert.equal(event.provider, 'gitlab');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'open');
  assert.equal(event.resource.number, 23);
  assert.equal(event.resource.title, 'New API: create/update/delete file');
  assert.equal(event.resource.description, 'Create new API for manipulations with repository');
  assert.equal(event.resource.url, 'http://example.com/diaspora/issues/23');
  assert.equal(event.resource.state, 'opened');
  assert.equal(event.resource.repository, 'gitlab-org/gitlab-test');
  assert.equal(event.resource.author, 'root');
  // Top-level assignees array (full user objects from canonical payload)
  assert.ok(event.resource.assignees && (event.resource.assignees as any[]).length === 1);
  assert.equal((event.resource.assignees as any[])[0].username, 'user1');
  // Labels: only title is extracted from full label objects
  assert.deepEqual(event.resource.labels, ['API']);
  assert.equal(event.actor.username, 'root');
  assert.equal(event.actor.id, 1);
  assert.ok(event.id.startsWith('gitlab:gitlab-org/gitlab-test:open:301:'));
  assert.equal(event.resource.comment, undefined);
  // metadata.timestamp must be a valid ISO string
  assert.ok(!isNaN(new Date(event.metadata.timestamp as string).getTime()));
  // raw preserves the full payload
  assert.deepEqual(event.raw, issueOpenedPayload);
});

test('normalizeWebhookEvent - issue with no description uses empty string', () => {
  const payload = {
    ...issueOpenedPayload,
    object_attributes: { ...issueOpenedPayload.object_attributes, description: undefined },
  };
  const event = normalizeWebhookEvent(payload as any);
  assert.equal(event.resource.description, '');
});

test('normalizeWebhookEvent - issue with no user falls back to unknown actor', () => {
  const payload = { ...issueOpenedPayload, user: undefined };
  const event = normalizeWebhookEvent(payload as any);
  assert.equal(event.actor.username, 'unknown');
  assert.equal(event.actor.id, 0);
  assert.equal(event.resource.author, undefined);
});

test('normalizeWebhookEvent - issue with empty labels has no labels field', () => {
  const payload = {
    ...issueOpenedPayload,
    labels: [],
    object_attributes: { ...issueOpenedPayload.object_attributes, labels: [] },
  };
  const event = normalizeWebhookEvent(payload as any);
  assert.equal(event.resource.labels, undefined);
});

// --- normalizeWebhookEvent: merge_request ---

test('normalizeWebhookEvent - MR opened: branches and labels extracted', () => {
  const event = normalizeWebhookEvent(mrOpenedPayload as any);

  assert.equal(event.type, 'merge_request');
  assert.equal(event.action, 'open');
  assert.equal(event.resource.number, 16);
  assert.equal(event.resource.title, 'Add input validation to booking form');
  assert.equal(event.resource.url, 'http://example.com/gitlab-org/gitlab-test/-/merge_requests/16');
  assert.equal(event.resource.state, 'opened');
  assert.equal(event.resource.repository, 'gitlab-org/gitlab-test');
  // Branch info is essential for {{resource.branch}} and {{resource.mergeTo}} in the template
  assert.equal(event.resource.branch, 'feature/booking-validation');
  assert.equal(event.resource.mergeTo, 'main');
  assert.deepEqual(event.resource.labels, ['enhancement']);
  assert.ok(event.resource.assignees && (event.resource.assignees as any[]).length === 1);
  assert.equal(event.actor.username, 'root');
});

// --- normalizeWebhookEvent: note (comment) ---

test('normalizeWebhookEvent - note on issue: type is issue, comment fields populated', () => {
  const event = normalizeWebhookEvent(noteOnIssuePayload as any);

  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'note');
  // Number and title come from the sibling issue object, not object_attributes
  assert.equal(event.resource.number, 17);
  assert.equal(event.resource.title, 'test');
  assert.equal(event.resource.description, 'test issue body');
  // resource.url is the issue URL (fragment stripped from note URL)
  assert.equal(event.resource.url, 'http://example.com/gitlab-org/gitlab-test/issues/17');
  assert.equal(event.resource.state, 'closed');
  assert.equal(event.resource.repository, 'gitlab-org/gitlab-test');
  // comment fields are used by {{resource.comment.body}} and {{resource.comment.author}}
  assert.equal(event.resource.comment?.body, 'Hello world');
  assert.equal(event.resource.comment?.author, 'root');
  // comment.url is the full note URL (with #note_NNN fragment)
  assert.equal(
    event.resource.comment?.url,
    'http://example.com/gitlab-org/gitlab-test/issues/17#note_1241'
  );
  // labels come from the parent issue's labels
  assert.deepEqual(event.resource.labels, ['Afterpod']);
  assert.equal(event.actor.username, 'root');
  assert.equal(event.actor.id, 1);
  assert.ok(event.id.startsWith('gitlab:gitlab-org/gitlab-test:note:1241:'));
});

test('normalizeWebhookEvent - note on MR: type is merge_request, branches populated', () => {
  const event = normalizeWebhookEvent(noteOnMRPayload as any);

  assert.equal(event.type, 'merge_request');
  assert.equal(event.action, 'note');
  assert.equal(event.resource.number, 1);
  assert.equal(event.resource.title, 'Tempora et eos debitis quae laborum et.');
  // resource.url is the MR URL (fragment stripped)
  assert.equal(event.resource.url, 'http://example.com/gitlab-org/gitlab-test/merge_requests/1');
  assert.equal(event.resource.state, 'opened');
  // branch fields from the sibling merge_request object
  assert.equal(event.resource.branch, 'master');
  assert.equal(event.resource.mergeTo, 'markdown');
  assert.equal(event.resource.comment?.body, 'This MR needs work.');
  assert.equal(event.resource.comment?.author, 'root');
  assert.equal(
    event.resource.comment?.url,
    'http://example.com/gitlab-org/gitlab-test/merge_requests/1#note_1244'
  );
  assert.deepEqual(event.resource.labels, ['Element']);
});

// --- normalizePolledEvent ---

test('normalizePolledEvent - polled issue', () => {
  // GitLab REST API v4 returns labels as plain strings (not objects) for issues/MRs
  const item = {
    project: 'gitlab-org/gitlab-test',
    type: 'issue',
    number: 17,
    data: {
      id: 92,
      iid: 17,
      title: 'test',
      description: 'test issue body',
      web_url: 'http://example.com/gitlab-org/gitlab-test/-/issues/17',
      state: 'opened',
      author: { id: 1, name: 'Administrator', username: 'root', avatar_url: '...' },
      assignees: [{ id: 51, name: 'User1', username: 'user1', avatar_url: '...' }],
      labels: ['bug', 'priority'],
      created_at: '2015-04-12T14:53:17Z',
      updated_at: '2015-05-17T17:06:40Z',
    },
  };

  const before = Date.now();
  const event = normalizePolledEvent(item);
  const after = Date.now();

  assert.equal(event.provider, 'gitlab');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'poll');
  assert.equal(event.resource.number, 17);
  assert.equal(event.resource.title, 'test');
  assert.equal(event.resource.description, 'test issue body');
  assert.equal(event.resource.url, 'http://example.com/gitlab-org/gitlab-test/-/issues/17');
  assert.equal(event.resource.state, 'opened');
  assert.equal(event.resource.repository, 'gitlab-org/gitlab-test');
  assert.equal(event.resource.author, 'root');
  assert.ok(event.resource.assignees && (event.resource.assignees as any[]).length === 1);
  // Labels are plain strings in the GitLab REST API response
  assert.deepEqual(event.resource.labels, ['bug', 'priority']);
  assert.equal(event.metadata.polled, true);
  const parsed = new Date(event.metadata.timestamp as string).getTime();
  assert.ok(!isNaN(parsed) && parsed >= before && parsed <= after);
  assert.ok(event.id.startsWith('gitlab:gitlab-org/gitlab-test:poll:17:'));
  assert.equal(event.actor.username, 'root');
  assert.equal(event.actor.id, 1);
  // raw is item.data (not the wrapper)
  assert.deepEqual(event.raw, item.data);
});

test('normalizePolledEvent - polled MR: branches extracted', () => {
  const item = {
    project: 'gitlab-org/gitlab-test',
    type: 'merge_request',
    number: 1,
    data: {
      id: 7,
      iid: 1,
      title: 'Tempora et eos debitis quae laborum et.',
      description: 'Et voluptas corrupti assumenda temporibus.',
      web_url: 'http://example.com/gitlab-org/gitlab-test/-/merge_requests/1',
      state: 'opened',
      source_branch: 'master',
      target_branch: 'markdown',
      author: { id: 8, name: 'User2', username: 'user2', avatar_url: '...' },
      assignees: [],
      labels: ['enhancement'],
    },
  };

  const event = normalizePolledEvent(item);

  assert.equal(event.type, 'merge_request');
  assert.equal(event.resource.branch, 'master');
  assert.equal(event.resource.mergeTo, 'markdown');
  assert.equal(event.resource.url, 'http://example.com/gitlab-org/gitlab-test/-/merge_requests/1');
  assert.equal(event.resource.state, 'opened');
  assert.deepEqual(event.resource.labels, ['enhancement']);
  assert.equal(event.actor.username, 'user2');
});

test('normalizePolledEvent - issue with no labels has no labels field', () => {
  const item = {
    project: 'gitlab-org/gitlab-test',
    type: 'issue',
    number: 5,
    data: {
      id: 10,
      iid: 5,
      title: 'Simple issue',
      web_url: 'http://example.com/gitlab-org/gitlab-test/-/issues/5',
      state: 'opened',
      author: { id: 1, username: 'root' },
      assignees: [],
      labels: [],
    },
  };

  const event = normalizePolledEvent(item);
  assert.equal(event.resource.labels, undefined);
});

test('normalizePolledEvent - issue with no body uses empty string', () => {
  const item = {
    project: 'gitlab-org/gitlab-test',
    type: 'issue',
    number: 5,
    data: {
      id: 10,
      iid: 5,
      title: 'Simple issue',
      web_url: 'http://example.com/gitlab-org/gitlab-test/-/issues/5',
      state: 'opened',
      author: { id: 1, username: 'root' },
      assignees: [],
      labels: [],
    },
  };

  const event = normalizePolledEvent(item);
  assert.equal(event.resource.description, '');
});
