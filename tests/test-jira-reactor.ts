import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JiraReactor } from '../src/watcher/providers/jira/JiraReactor.js';
import type { JiraComments } from '../src/watcher/providers/jira/JiraComments.js';

// Jira REST API v3 GET /issue/{key}/comment returns a "values" array.
// Each entry has: id, author { accountId, displayName }, body (ADF or string), created.

interface MockComment {
  id: string;
  author: { accountId: string; displayName: string };
  body: unknown;
  created: string;
}

function makeReactor(
  opts: {
    botUsernames?: string[];
    comments?: MockComment[];
    postShouldReturn?: string;
    postShouldThrow?: Error;
  } = {}
): JiraReactor {
  const mockComments: Partial<InstanceType<typeof JiraComments>> = {
    getComments: async () => opts.comments ?? [],
    postComment: async () => {
      if (opts.postShouldThrow) throw opts.postShouldThrow;
      return opts.postShouldReturn ?? 'comment-id-abc';
    },
  };

  return new JiraReactor(
    mockComments as InstanceType<typeof JiraComments>,
    'PROJ-123',
    opts.botUsernames ?? ['Coworker Bot']
  );
}

// --- isBotAuthor() ---

test('JiraReactor.isBotAuthor - returns true for the configured bot display name', () => {
  const reactor = makeReactor({ botUsernames: ['Coworker Bot'] });
  assert.equal(reactor.isBotAuthor('Coworker Bot'), true);
});

test('JiraReactor.isBotAuthor - comparison is case-insensitive', () => {
  const reactor = makeReactor({ botUsernames: ['Coworker Bot'] });
  assert.equal(reactor.isBotAuthor('coworker bot'), true);
  assert.equal(reactor.isBotAuthor('COWORKER BOT'), true);
});

test('JiraReactor.isBotAuthor - returns false for a non-bot author', () => {
  const reactor = makeReactor({ botUsernames: ['Coworker Bot'] });
  assert.equal(reactor.isBotAuthor('Alice Smith'), false);
  assert.equal(reactor.isBotAuthor(''), false);
});

test('JiraReactor.isBotAuthor - returns true for any bot in a multi-bot list', () => {
  const reactor = makeReactor({ botUsernames: ['Bot A', 'Bot B'] });
  assert.equal(reactor.isBotAuthor('Bot A'), true);
  assert.equal(reactor.isBotAuthor('Bot B'), true);
  assert.equal(reactor.isBotAuthor('Bot C'), false);
});

test('JiraReactor.isBotAuthor - empty list always returns false', () => {
  const reactor = makeReactor({ botUsernames: [] });
  assert.equal(reactor.isBotAuthor('anyone'), false);
});

// --- getLastComment() ---

test('JiraReactor.getLastComment - returns null when there are no comments', async () => {
  const reactor = makeReactor({ comments: [] });
  assert.equal(await reactor.getLastComment(), null);
});

test('JiraReactor.getLastComment - returns the last comment author and body', async () => {
  const reactor = makeReactor({
    comments: [
      {
        id: 'c1',
        author: { accountId: 'acc-1', displayName: 'Alice Smith' },
        body: 'First comment',
        created: '2024-01-01T00:00:00Z',
      },
      {
        id: 'c2',
        author: { accountId: 'acc-2', displayName: 'Coworker Bot' },
        body: 'Agent is working on PROJ-123',
        created: '2024-01-02T00:00:00Z',
      },
    ],
  });
  const result = await reactor.getLastComment();
  assert.ok(result !== null);
  assert.equal(result.author, 'Coworker Bot');
  assert.equal(result.body, 'Agent is working on PROJ-123');
});

test('JiraReactor.getLastComment - ADF body is extracted to plain text', async () => {
  const adfBody = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Agent is working on this' }],
      },
    ],
  };
  const reactor = makeReactor({
    comments: [
      {
        id: 'c1',
        author: { accountId: 'acc-bot', displayName: 'Coworker Bot' },
        body: adfBody,
        created: '2024-01-01T00:00:00Z',
      },
    ],
  });
  const result = await reactor.getLastComment();
  assert.ok(result !== null);
  assert.ok(
    result.body.includes('Agent is working on this'),
    `expected extracted text, got: ${result.body}`
  );
});

test('JiraReactor.getLastComment - propagates errors from the comments API', async () => {
  const mockComments = {
    getComments: async () => {
      throw new Error('Jira API unavailable');
    },
  } as unknown as InstanceType<typeof JiraComments>;
  const reactor = new JiraReactor(mockComments, 'PROJ-123', []);
  await assert.rejects(() => reactor.getLastComment(), { message: 'Jira API unavailable' });
});

// --- postComment() ---

test('JiraReactor.postComment - returns the comment ID from the API', async () => {
  const reactor = makeReactor({ postShouldReturn: 'new-comment-id-xyz' });
  const result = await reactor.postComment('Hello Jira');
  assert.equal(result, 'new-comment-id-xyz');
});

test('JiraReactor.postComment - propagates errors from the comments API', async () => {
  const reactor = makeReactor({ postShouldThrow: new Error('Jira post failed') });
  await assert.rejects(() => reactor.postComment('A comment'), { message: 'Jira post failed' });
});
