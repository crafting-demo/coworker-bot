import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWebhookEvent,
  normalizePolledEvent,
  normalizeCommentEvent,
} from '../src/watcher/providers/linear/LinearNormalizer.js';

// Fixtures — structures match real Linear webhook payloads as documented at
// https://linear.app/developers/webhooks#webhook-payload
//
// Canonical outer payload fields (data-change events):
//   action, type, createdAt, url, organizationId, webhookTimestamp, webhookId,
//   actor (who triggered the event), data (serialized entity), updatedFrom
//
// Linear docs: "The format of the webhook payload body reflects that of the
// corresponding GraphQL entity." Labels therefore use the { nodes: [...] }
// connection structure, matching the GraphQL API shape.
//
// actor (outer) is the user who triggered the event (may differ from data.creator
// for update events). The normalizer currently derives actor from data.creator —
// a future improvement could use the outer actor for update events.

const issueCreatedPayload = {
  action: 'create',
  type: 'Issue',
  createdAt: '2024-01-15T10:00:00.000Z',
  url: 'https://linear.app/org/issue/ENG-42/fix-auth-bug',
  organizationId: 'org-abc-123',
  webhookTimestamp: 1705312800000,
  actor: {
    id: 'user-alice-id',
    type: 'user',
    name: 'Alice',
    email: 'alice@example.com',
    url: 'https://linear.app/org/profiles/alice',
  },
  data: {
    id: 'issue-abc',
    identifier: 'ENG-42',
    number: 42,
    title: 'Fix auth bug',
    description: 'OAuth fails on mobile.',
    url: 'https://linear.app/org/issue/ENG-42',
    state: { name: 'In Progress', type: 'started', color: '#f2c94c' },
    team: { key: 'ENG', name: 'Engineering' },
    creator: { id: 'user-alice-id', name: 'Alice' },
    updatedAt: '2024-01-15T10:00:00.000Z',
    createdAt: '2024-01-15T10:00:00.000Z',
  },
};

const issueWithMetaPayload = {
  action: 'update',
  type: 'Issue',
  createdAt: '2024-01-15T11:00:00.000Z',
  url: 'https://linear.app/org/issue/ENG-43/improve-search',
  organizationId: 'org-abc-123',
  webhookTimestamp: 1705316400000,
  actor: {
    id: 'user-bob-id',
    type: 'user',
    name: 'Bob',
    email: 'bob@example.com',
    url: 'https://linear.app/org/profiles/bob',
  },
  updatedFrom: {
    title: 'Old title',
    updatedAt: '2024-01-14T09:00:00.000Z',
  },
  data: {
    id: 'issue-def',
    identifier: 'ENG-43',
    number: 43,
    title: 'Improve search',
    description: 'Search should be faster.',
    url: 'https://linear.app/org/issue/ENG-43',
    state: { name: 'Todo', type: 'unstarted', color: '#e2e2e2' },
    team: { key: 'ENG', name: 'Engineering' },
    assignee: { id: 'user-bob-id', name: 'Bob' },
    creator: { id: 'user-carol-id', name: 'Carol' },
    labels: {
      nodes: [
        { id: 'label-perf-id', name: 'performance' },
        { id: 'label-be-id', name: 'backend' },
      ],
    },
    updatedAt: '2024-01-15T11:00:00.000Z',
    createdAt: '2024-01-14T09:00:00.000Z',
  },
};

// --- normalizeWebhookEvent ---

test('normalizeWebhookEvent - issue create event', () => {
  const event = normalizeWebhookEvent(issueCreatedPayload as any, 'webhook-id-1');

  assert.equal(event.provider, 'linear');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'create');
  assert.equal(event.resource.number, 42);
  assert.equal(event.resource.title, 'Fix auth bug');
  assert.equal(event.resource.description, 'OAuth fails on mobile.');
  assert.equal(event.resource.state, 'In Progress');
  assert.equal(event.resource.repository, 'ENG');
  // url is used by {{resourceLink}} in the prompt template
  assert.equal(event.resource.url, 'https://linear.app/org/issue/ENG-42');
  assert.equal(event.resource.author, 'Alice');
  assert.equal(event.actor.username, 'Alice');
  assert.equal(event.actor.id, 'issue-abc');
  assert.equal(event.id, 'linear:ENG:create:issue-abc:webhook-id-1');
  // metadata.timestamp is used by {{metadata.timestamp}} in the prompt template
  assert.equal(event.metadata.timestamp, '2024-01-15T10:00:00.000Z');
  // raw preserves full payload for debugging and future template use
  assert.deepEqual(event.raw, issueCreatedPayload);
});

test('normalizeWebhookEvent - issue with assignee and labels', () => {
  const event = normalizeWebhookEvent(issueWithMetaPayload as any, 'webhook-id-2');

  assert.equal(event.action, 'update');
  assert.deepEqual(event.resource.assignees, [{ id: 'user-bob-id', name: 'Bob' }]);
  // labels extracted from nodes structure (mirrors GraphQL entity format)
  assert.deepEqual(event.resource.labels, ['performance', 'backend']);
  assert.equal(event.resource.author, 'Carol');
});

test('normalizeWebhookEvent - issue with no description uses empty string', () => {
  const payload = {
    ...issueCreatedPayload,
    data: { ...issueCreatedPayload.data, description: undefined },
  };
  const event = normalizeWebhookEvent(payload as any, 'webhook-id-3');
  assert.equal(event.resource.description, '');
});

test('normalizeWebhookEvent - issue with no creator uses unknown actor', () => {
  const payload = {
    ...issueCreatedPayload,
    data: { ...issueCreatedPayload.data, creator: undefined },
  };
  const event = normalizeWebhookEvent(payload as any, 'webhook-id-4');
  assert.equal(event.actor.username, 'unknown');
  assert.equal(event.resource.author, undefined);
});

test('normalizeWebhookEvent - issue with no assignee has no assignees field', () => {
  const event = normalizeWebhookEvent(issueCreatedPayload as any, 'webhook-id-5');
  assert.equal(event.resource.assignees, undefined);
});

test('normalizeWebhookEvent - issue with empty labels nodes has no labels field', () => {
  const payload = {
    ...issueCreatedPayload,
    data: { ...issueCreatedPayload.data, labels: { nodes: [] } },
  };
  const event = normalizeWebhookEvent(payload as any, 'webhook-id-6');
  assert.equal(event.resource.labels, undefined);
});

// --- normalizePolledEvent ---

test('normalizePolledEvent - polled issue', () => {
  const item = {
    team: 'ENG',
    data: {
      id: 'issue-abc',
      identifier: 'ENG-42',
      number: 42,
      title: 'Fix auth bug',
      description: 'OAuth fails on mobile.',
      url: 'https://linear.app/org/issue/ENG-42',
      state: { name: 'In Progress', type: 'started', color: '#f2c94c' },
      team: { key: 'ENG', name: 'Engineering' },
      creator: { id: 'user-alice-id', name: 'Alice' },
      labels: { nodes: [{ id: 'label-bug-id', name: 'bug' }] },
    },
  };

  const event = normalizePolledEvent(item);

  assert.equal(event.provider, 'linear');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'poll');
  assert.equal(event.resource.number, 42);
  assert.equal(event.resource.repository, 'ENG');
  // url is used by {{resourceLink}} in the prompt template
  assert.equal(event.resource.url, 'https://linear.app/org/issue/ENG-42');
  assert.equal(event.resource.state, 'In Progress');
  assert.deepEqual(event.resource.labels, ['bug']);
  assert.equal(event.metadata.polled, true);
  // metadata.timestamp is set to now() for polled events
  assert.ok(typeof event.metadata.timestamp === 'string');
  assert.ok(!isNaN(new Date(event.metadata.timestamp as string).getTime()));
  assert.ok(event.id.startsWith('linear:ENG:poll:42:'));
  assert.equal(event.actor.username, 'Alice');
  assert.equal(event.actor.id, 'issue-abc');
  assert.equal(event.resource.author, 'Alice');
});

test('normalizePolledEvent - polled issue without labels', () => {
  const item = {
    team: 'ENG',
    data: {
      id: 'issue-xyz',
      identifier: 'ENG-99',
      number: 99,
      title: 'Other task',
      url: 'https://linear.app/org/issue/ENG-99',
      state: { name: 'Todo', type: 'unstarted', color: '#e2e2e2' },
      team: { key: 'ENG', name: 'Engineering' },
      labels: { nodes: [] },
    },
  };

  const event = normalizePolledEvent(item);
  assert.equal(event.resource.labels, undefined);
});

test('normalizePolledEvent - raw data is the data object not the wrapper', () => {
  const item = {
    team: 'ENG',
    data: {
      id: 'issue-abc',
      identifier: 'ENG-42',
      number: 42,
      title: 'Fix auth bug',
      url: 'https://linear.app/org/issue/ENG-42',
      state: { name: 'In Progress', type: 'started', color: '#f2c94c' },
      team: { key: 'ENG', name: 'Engineering' },
      labels: { nodes: [] },
    },
  };

  const event = normalizePolledEvent(item);
  assert.deepEqual(event.raw, item.data);
});

// --- normalizeCommentEvent ---

const commentPayload = {
  action: 'create',
  type: 'Comment' as const,
  createdAt: '2024-01-15T12:00:00.000Z',
  organizationId: 'org-abc-123',
  webhookTimestamp: 1705320000000,
  actor: {
    id: 'user-bob-id',
    type: 'user',
    name: 'Bob',
    email: 'bob@example.com',
    url: 'https://linear.app/org/profiles/bob',
  },
  data: {
    id: 'comment-xyz',
    body: 'Hey @coworker-bot can you look at this?',
    user: { id: 'user-bob-id', name: 'Bob' },
    issue: {
      id: 'issue-abc',
      identifier: 'ENG-42',
      number: 42,
      title: 'Fix auth bug',
      description: 'OAuth fails on mobile.',
      url: 'https://linear.app/org/issue/ENG-42',
      state: { name: 'In Progress', type: 'started' },
      team: { key: 'ENG', name: 'Engineering' },
      assignee: { id: 'user-alice-id', name: 'Alice' },
      labels: { nodes: [{ id: 'label-bug-id', name: 'bug' }] },
    },
    createdAt: '2024-01-15T12:00:00.000Z',
  },
};

test('normalizeCommentEvent - core fields from parent issue', () => {
  const event = normalizeCommentEvent(commentPayload, 'webhook-id-c1');

  assert.equal(event.provider, 'linear');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'comment');
  assert.equal(event.resource.number, 42);
  assert.equal(event.resource.title, 'Fix auth bug');
  assert.equal(event.resource.description, 'OAuth fails on mobile.');
  assert.equal(event.resource.url, 'https://linear.app/org/issue/ENG-42');
  assert.equal(event.resource.state, 'In Progress');
  assert.equal(event.resource.repository, 'ENG');
});

test('normalizeCommentEvent - comment fields populated', () => {
  const event = normalizeCommentEvent(commentPayload, 'webhook-id-c2');

  assert.equal(event.resource.comment?.body, 'Hey @coworker-bot can you look at this?');
  assert.equal(event.resource.comment?.author, 'Bob');
});

test('normalizeCommentEvent - actor from outer actor field', () => {
  const event = normalizeCommentEvent(commentPayload, 'webhook-id-c3');

  assert.equal(event.actor.username, 'Bob');
  assert.equal(event.actor.id, 'comment-xyz');
});

test('normalizeCommentEvent - assignees and labels from parent issue', () => {
  const event = normalizeCommentEvent(commentPayload, 'webhook-id-c4');

  assert.ok(event.resource.assignees && (event.resource.assignees as any[]).length === 1);
  assert.equal((event.resource.assignees as any[])[0].name, 'Alice');
  assert.deepEqual(event.resource.labels, ['bug']);
});

test('normalizeCommentEvent - event id format', () => {
  const event = normalizeCommentEvent(commentPayload, 'webhook-id-c5');
  assert.equal(event.id, 'linear:ENG:comment:comment-xyz:webhook-id-c5');
});

test('normalizeCommentEvent - metadata.timestamp from payload.createdAt', () => {
  const event = normalizeCommentEvent(commentPayload, 'webhook-id-c6');
  assert.equal(event.metadata.timestamp, '2024-01-15T12:00:00.000Z');
});

test('normalizeCommentEvent - raw is the full payload', () => {
  const event = normalizeCommentEvent(commentPayload, 'webhook-id-c7');
  assert.deepEqual(event.raw, commentPayload);
});

test('normalizeCommentEvent - no description on parent issue uses empty string', () => {
  const payload = {
    ...commentPayload,
    data: {
      ...commentPayload.data,
      issue: { ...commentPayload.data.issue, description: undefined },
    },
  };
  const event = normalizeCommentEvent(payload as any, 'webhook-id-c8');
  assert.equal(event.resource.description, '');
});

test('normalizeCommentEvent - no user falls back to unknown actor', () => {
  const payload = {
    ...commentPayload,
    actor: undefined,
    data: { ...commentPayload.data, user: undefined },
  };
  const event = normalizeCommentEvent(payload as any, 'webhook-id-c9');
  assert.equal(event.actor.username, 'unknown');
  assert.equal(event.resource.comment?.author, 'unknown');
});

test('normalizeCommentEvent - empty labels on parent issue has no labels field', () => {
  const payload = {
    ...commentPayload,
    data: {
      ...commentPayload.data,
      issue: { ...commentPayload.data.issue, labels: { nodes: [] } },
    },
  };
  const event = normalizeCommentEvent(payload as any, 'webhook-id-c10');
  assert.equal(event.resource.labels, undefined);
});
