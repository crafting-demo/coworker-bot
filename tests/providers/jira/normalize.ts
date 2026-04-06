import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTextFromADF,
  normalizeWebhookIssueEvent,
  normalizeWebhookCommentEvent,
  normalizePolledIssue,
} from '../../../src/watcher/providers/jira/JiraNormalizer.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// Shapes match real Jira Cloud REST API v3 / webhook payloads.
//
// Issue webhook payloads (jira:issue_created / jira:issue_updated) include
// status, project, assignee, reporter, labels in fields.
//
// Comment webhook payloads (comment_created / comment_updated) contain a
// minimal issue stub — only summary is guaranteed in fields; status and
// project are absent.
//
// Search results (POST /rest/api/3/search) always include all requested
// fields including status and project.

// Full issue webhook payload
const issueCreatedPayload = {
  timestamp: 1705312800000,
  webhookEvent: 'jira:issue_created',
  issue_event_type_name: 'issue_created',
  user: {
    accountId: 'acc-alice',
    displayName: 'Alice Smith',
    emailAddress: 'alice@example.com',
  },
  issue: {
    id: '10042',
    key: 'PROJ-123',
    self: 'https://example.atlassian.net/rest/api/3/issue/10042',
    fields: {
      summary: 'Fix login bug',
      description: 'Users cannot log in on mobile.',
      status: { name: 'To Do' },
      project: { key: 'PROJ', name: 'My Project' },
      reporter: { accountId: 'acc-alice', displayName: 'Alice Smith' },
      assignee: null,
      labels: [],
      updated: 1705312800000,
    },
  },
};

const issueWithMetaPayload = {
  timestamp: 1705316400000,
  webhookEvent: 'jira:issue_updated',
  issue_event_type_name: 'issue_assigned',
  user: {
    accountId: 'acc-bob',
    displayName: 'Bob Jones',
    emailAddress: 'bob@example.com',
  },
  issue: {
    id: '10043',
    key: 'PROJ-456',
    self: 'https://example.atlassian.net/rest/api/3/issue/10043',
    fields: {
      summary: 'Improve search performance',
      description: 'Search is too slow.',
      status: { name: 'In Progress' },
      project: { key: 'PROJ', name: 'My Project' },
      reporter: { accountId: 'acc-carol', displayName: 'Carol White' },
      assignee: { accountId: 'acc-bot', displayName: 'Coworker Bot' },
      labels: ['performance', 'backend'],
      updated: 1705316400000,
    },
  },
};

// Minimal comment webhook payload — issue stub only has summary
const commentCreatedPayload = {
  timestamp: 1705320000000,
  webhookEvent: 'comment_created',
  comment: {
    id: 'comment-99',
    self: 'https://example.atlassian.net/rest/api/3/issue/10042/comment/comment-99',
    author: { accountId: 'acc-bob', displayName: 'Bob Jones' },
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hey ' },
            { type: 'mention', attrs: { id: 'acc-bot', text: '@Coworker Bot' } },
            { type: 'text', text: ' can you fix this?' },
          ],
        },
      ],
    },
    created: '2024-01-15T12:00:00.000+0000',
  },
  // Minimal issue stub — no status or project in fields
  issue: {
    id: '10042',
    key: 'PROJ-123',
    self: 'https://example.atlassian.net/rest/api/3/issue/10042',
    fields: {
      summary: 'Fix login bug',
      assignee: { accountId: 'acc-alice', displayName: 'Alice Smith' },
    },
  },
};

// Search result (polled) — all fields present.
// updated and created are Unix epoch milliseconds (integer) per the search/jql response schema.
const polledIssue = {
  id: '10042',
  key: 'PROJ-123',
  self: 'https://example.atlassian.net/rest/api/3/issue/10042',
  fields: {
    summary: 'Fix login bug',
    description: 'Users cannot log in on mobile.',
    status: { name: 'In Progress' },
    project: { key: 'PROJ', name: 'My Project' },
    reporter: { accountId: 'acc-alice', displayName: 'Alice Smith' },
    assignee: { accountId: 'acc-bot', displayName: 'Coworker Bot' },
    labels: ['auth', 'mobile'],
    updated: 1705312800000, // Unix ms — matches search/jql response type
  },
};

// ─── extractTextFromADF ───────────────────────────────────────────────────────

test('extractTextFromADF - plain string passthrough', () => {
  assert.equal(extractTextFromADF('hello world'), 'hello world');
});

test('extractTextFromADF - null or undefined returns empty string', () => {
  assert.equal(extractTextFromADF(null), '');
  assert.equal(extractTextFromADF(undefined), '');
});

test('extractTextFromADF - simple ADF paragraph with text', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    ],
  };
  assert.equal(extractTextFromADF(adf).trim(), 'Hello world');
});

test('extractTextFromADF - ADF mention is extracted as @display text', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hey ' },
          { type: 'mention', attrs: { id: 'acc-bot', text: '@Coworker Bot' } },
          { type: 'text', text: ' please help' },
        ],
      },
    ],
  };
  const text = extractTextFromADF(adf);
  assert.ok(text.includes('@Coworker Bot'), `expected mention in: ${text}`);
  assert.ok(text.includes('Hey '), `expected prefix in: ${text}`);
  assert.ok(text.includes('please help'), `expected suffix in: ${text}`);
});

test('extractTextFromADF - hardBreak becomes newline', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'hardBreak' },
          { type: 'text', text: 'line two' },
        ],
      },
    ],
  };
  const text = extractTextFromADF(adf);
  assert.ok(text.includes('\n'), `expected newline in: ${JSON.stringify(text)}`);
  assert.ok(text.includes('line one'), `expected line one in: ${text}`);
  assert.ok(text.includes('line two'), `expected line two in: ${text}`);
});

test('extractTextFromADF - ADF with no content returns empty string', () => {
  assert.equal(extractTextFromADF({ type: 'doc', version: 1 }), '');
});

// ─── normalizeWebhookIssueEvent ───────────────────────────────────────────────

test('normalizeWebhookIssueEvent - core fields', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-1');

  assert.equal(event.provider, 'jira');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'issue_created'); // issue_event_type_name takes precedence
  assert.equal(event.resource.number, 123);
  assert.equal(event.resource.title, 'Fix login bug');
  assert.equal(event.resource.description, 'Users cannot log in on mobile.');
  assert.equal(event.resource.state, 'To Do');
  assert.equal(event.resource.repository, 'PROJ');
});

test('normalizeWebhookIssueEvent - URL is browse URL not REST API URL', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-2');
  assert.equal(event.resource.url, 'https://example.atlassian.net/browse/PROJ-123');
});

test('normalizeWebhookIssueEvent - event ID format', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-3');
  assert.equal(event.id, 'jira:PROJ:jira:issue_created:PROJ-123:delivery-3');
});

test('normalizeWebhookIssueEvent - actor from payload.user', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-4');
  assert.equal(event.actor.username, 'Alice Smith');
  assert.equal(event.actor.id, 'acc-alice');
});

test('normalizeWebhookIssueEvent - reporter set as author', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-5');
  assert.equal(event.resource.author, 'Alice Smith');
});

test('normalizeWebhookIssueEvent - metadata timestamp from webhook timestamp', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-6');
  assert.equal(event.metadata.timestamp, new Date(1705312800000).toISOString());
  assert.equal(event.metadata.issueKey, 'PROJ-123');
});

test('normalizeWebhookIssueEvent - raw is the full payload', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-7');
  assert.deepEqual(event.raw, issueCreatedPayload);
});

test('normalizeWebhookIssueEvent - assignee and labels populated', () => {
  const event = normalizeWebhookIssueEvent(issueWithMetaPayload as any, 'delivery-8');
  assert.ok(Array.isArray(event.resource.assignees));
  assert.equal((event.resource.assignees as any[])[0].displayName, 'Coworker Bot');
  assert.deepEqual(event.resource.labels, ['performance', 'backend']);
});

test('normalizeWebhookIssueEvent - no assignee has no assignees field', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-9');
  assert.equal(event.resource.assignees, undefined);
});

test('normalizeWebhookIssueEvent - empty labels has no labels field', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-10');
  assert.equal(event.resource.labels, undefined);
});

test('normalizeWebhookIssueEvent - no description uses empty string', () => {
  const payload = {
    ...issueCreatedPayload,
    issue: {
      ...issueCreatedPayload.issue,
      fields: { ...issueCreatedPayload.issue.fields, description: undefined },
    },
  };
  const event = normalizeWebhookIssueEvent(payload as any, 'delivery-11');
  assert.equal(event.resource.description, '');
});

test('normalizeWebhookIssueEvent - project key extracted from issue key when fields.project absent', () => {
  const payload = {
    ...issueCreatedPayload,
    issue: {
      ...issueCreatedPayload.issue,
      fields: { ...issueCreatedPayload.issue.fields, project: undefined },
    },
  };
  const event = normalizeWebhookIssueEvent(payload as any, 'delivery-12');
  assert.equal(event.resource.repository, 'PROJ');
});

test('normalizeWebhookIssueEvent - status defaults to unknown when fields.status absent', () => {
  const payload = {
    ...issueCreatedPayload,
    issue: {
      ...issueCreatedPayload.issue,
      fields: { ...issueCreatedPayload.issue.fields, status: undefined },
    },
  };
  const event = normalizeWebhookIssueEvent(payload as any, 'delivery-13');
  assert.equal(event.resource.state, 'unknown');
});

test('normalizeWebhookIssueEvent - actor falls back to reporter when user absent', () => {
  const payload = { ...issueCreatedPayload, user: undefined };
  const event = normalizeWebhookIssueEvent(payload as any, 'delivery-14');
  assert.equal(event.actor.username, 'Alice Smith');
});

test('normalizeWebhookIssueEvent - actor is unknown when both user and reporter absent', () => {
  const payload = {
    ...issueCreatedPayload,
    user: undefined,
    issue: {
      ...issueCreatedPayload.issue,
      fields: { ...issueCreatedPayload.issue.fields, reporter: undefined },
    },
  };
  const event = normalizeWebhookIssueEvent(payload as any, 'delivery-15');
  assert.equal(event.actor.username, 'unknown');
});

// ─── normalizeWebhookCommentEvent ─────────────────────────────────────────────

test('normalizeWebhookCommentEvent - core fields from parent issue', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c1');

  assert.equal(event.provider, 'jira');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'comment');
  assert.equal(event.resource.number, 123);
  assert.equal(event.resource.title, 'Fix login bug');
  assert.equal(event.resource.repository, 'PROJ'); // extracted from issue key
  assert.equal(event.resource.url, 'https://example.atlassian.net/browse/PROJ-123');
});

test('normalizeWebhookCommentEvent - status defaults to unknown (absent in comment stub)', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c2');
  assert.equal(event.resource.state, 'unknown');
});

test('normalizeWebhookCommentEvent - comment fields populated and ADF extracted', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c3');

  assert.equal(event.resource.comment?.author, 'Bob Jones');
  assert.equal(
    event.resource.comment?.url,
    'https://example.atlassian.net/rest/api/3/issue/10042/comment/comment-99'
  );
  // ADF body with mention should contain the @mention text
  const body = event.resource.comment?.body ?? '';
  assert.ok(body.includes('@Coworker Bot'), `expected mention in body: ${body}`);
  assert.ok(body.includes('can you fix this?'), `expected text in body: ${body}`);
});

test('normalizeWebhookCommentEvent - actor is the comment author', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c4');
  assert.equal(event.actor.username, 'Bob Jones');
  assert.equal(event.actor.id, 'acc-bob');
});

test('normalizeWebhookCommentEvent - event ID format', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c5');
  assert.equal(event.id, 'jira:PROJ:comment:comment-99:delivery-c5');
});

test('normalizeWebhookCommentEvent - metadata timestamp and issueKey', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c6');
  assert.equal(event.metadata.timestamp, new Date(1705320000000).toISOString());
  assert.equal(event.metadata.issueKey, 'PROJ-123');
});

test('normalizeWebhookCommentEvent - assignees from issue stub', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c7');
  assert.ok(Array.isArray(event.resource.assignees));
  assert.equal((event.resource.assignees as any[])[0].displayName, 'Alice Smith');
});

test('normalizeWebhookCommentEvent - plain string body is preserved as-is', () => {
  const payload = {
    ...commentCreatedPayload,
    comment: { ...commentCreatedPayload.comment, body: 'Hey @Coworker Bot fix this' },
  };
  const event = normalizeWebhookCommentEvent(payload as any, 'delivery-c8');
  assert.equal(event.resource.comment?.body, 'Hey @Coworker Bot fix this');
});

test('normalizeWebhookCommentEvent - raw is the full payload', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c9');
  assert.deepEqual(event.raw, commentCreatedPayload);
});

test('normalizeWebhookCommentEvent - comment_created maps to action comment', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-c10');
  assert.equal(event.action, 'comment');
});

test('normalizeWebhookCommentEvent - comment_updated maps to action comment_updated', () => {
  const payload = { ...commentCreatedPayload, webhookEvent: 'comment_updated' };
  const event = normalizeWebhookCommentEvent(payload as any, 'delivery-c11');
  assert.equal(event.action, 'comment_updated');
});

test('normalizeWebhookCommentEvent - comment_deleted maps to action comment_deleted', () => {
  const payload = { ...commentCreatedPayload, webhookEvent: 'comment_deleted' };
  const event = normalizeWebhookCommentEvent(payload as any, 'delivery-c12');
  assert.equal(event.action, 'comment_deleted');
});

// ─── normalizePolledIssue ─────────────────────────────────────────────────────

test('normalizePolledIssue - core fields', () => {
  const event = normalizePolledIssue(polledIssue as any);

  assert.equal(event.provider, 'jira');
  assert.equal(event.type, 'issue');
  assert.equal(event.action, 'poll');
  assert.equal(event.resource.number, 123);
  assert.equal(event.resource.title, 'Fix login bug');
  assert.equal(event.resource.description, 'Users cannot log in on mobile.');
  assert.equal(event.resource.state, 'In Progress');
  assert.equal(event.resource.repository, 'PROJ');
  assert.equal(event.resource.url, 'https://example.atlassian.net/browse/PROJ-123');
});

test('normalizePolledIssue - assignee and labels populated', () => {
  const event = normalizePolledIssue(polledIssue as any);
  assert.ok(Array.isArray(event.resource.assignees));
  assert.equal((event.resource.assignees as any[])[0].displayName, 'Coworker Bot');
  assert.deepEqual(event.resource.labels, ['auth', 'mobile']);
});

test('normalizePolledIssue - author from reporter', () => {
  const event = normalizePolledIssue(polledIssue as any);
  assert.equal(event.resource.author, 'Alice Smith');
  assert.equal(event.actor.username, 'Alice Smith');
  assert.equal(event.actor.id, 'acc-alice');
});

test('normalizePolledIssue - metadata polled flag is true', () => {
  const event = normalizePolledIssue(polledIssue as any);
  assert.equal(event.metadata.polled, true);
  assert.ok(typeof event.metadata.timestamp === 'string');
  assert.ok(!isNaN(new Date(event.metadata.timestamp as string).getTime()));
});

test('normalizePolledIssue - event ID starts with expected prefix', () => {
  const event = normalizePolledIssue(polledIssue as any);
  assert.ok(event.id.startsWith('jira:PROJ:poll:PROJ-123:'), `unexpected id: ${event.id}`);
});

test('normalizePolledIssue - no labels field when labels array is empty', () => {
  const issue = {
    ...polledIssue,
    fields: { ...polledIssue.fields, labels: [] },
  };
  const event = normalizePolledIssue(issue as any);
  assert.equal(event.resource.labels, undefined);
});

test('normalizePolledIssue - no assignees field when assignee is null', () => {
  const issue = {
    ...polledIssue,
    fields: { ...polledIssue.fields, assignee: null },
  };
  const event = normalizePolledIssue(issue as any);
  assert.equal(event.resource.assignees, undefined);
});

test('normalizePolledIssue - raw is the full issue object', () => {
  const event = normalizePolledIssue(polledIssue as any);
  assert.deepEqual(event.raw, polledIssue);
});

// ─── actor.email mapping ───────────────────────────────────────────────────────

test('normalizeWebhookIssueEvent - actor.email from payload.user.emailAddress', () => {
  const event = normalizeWebhookIssueEvent(issueCreatedPayload as any, 'delivery-email-1');
  assert.equal(event.actor.email, 'alice@example.com');
});

test('normalizeWebhookIssueEvent - actor.email absent when payload.user has no emailAddress', () => {
  const payload = {
    ...issueCreatedPayload,
    user: { accountId: 'acc-alice', displayName: 'Alice Smith' },
  };
  const event = normalizeWebhookIssueEvent(payload as any, 'delivery-email-2');
  assert.equal(event.actor.email, undefined);
});

test('normalizeWebhookIssueEvent - actor.email from reporter when payload.user absent', () => {
  const payload = {
    ...issueCreatedPayload,
    user: undefined,
    issue: {
      ...issueCreatedPayload.issue,
      fields: {
        ...issueCreatedPayload.issue.fields,
        reporter: {
          accountId: 'acc-alice',
          displayName: 'Alice Smith',
          emailAddress: 'alice@example.com',
        },
      },
    },
  };
  const event = normalizeWebhookIssueEvent(payload as any, 'delivery-email-3');
  assert.equal(event.actor.email, 'alice@example.com');
});

test('normalizeWebhookCommentEvent - actor.email from comment.author.emailAddress', () => {
  const payload = {
    ...commentCreatedPayload,
    comment: {
      ...commentCreatedPayload.comment,
      author: { accountId: 'acc-bob', displayName: 'Bob Jones', emailAddress: 'bob@example.com' },
    },
  };
  const event = normalizeWebhookCommentEvent(payload as any, 'delivery-email-4');
  assert.equal(event.actor.email, 'bob@example.com');
});

test('normalizeWebhookCommentEvent - actor.email absent when comment author has no emailAddress', () => {
  const event = normalizeWebhookCommentEvent(commentCreatedPayload as any, 'delivery-email-5');
  assert.equal(event.actor.email, undefined);
});

test('normalizePolledIssue - actor.email from reporter.emailAddress', () => {
  const issue = {
    ...polledIssue,
    fields: {
      ...polledIssue.fields,
      reporter: {
        accountId: 'acc-alice',
        displayName: 'Alice Smith',
        emailAddress: 'alice@example.com',
      },
    },
  };
  const event = normalizePolledIssue(issue as any);
  assert.equal(event.actor.email, 'alice@example.com');
});

test('normalizePolledIssue - actor.email absent when reporter has no emailAddress', () => {
  const event = normalizePolledIssue(polledIssue as any);
  assert.equal(event.actor.email, undefined);
});
