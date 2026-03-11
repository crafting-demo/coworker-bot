import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinearReactor } from '../src/watcher/providers/linear/LinearReactor.js';
import type { LinearComments } from '../src/watcher/providers/linear/LinearComments.js';

interface MockLinearComment {
  id: string;
  body: string;
  user: { id: string; name: string; email: string; displayName: string };
  createdAt: string;
}

function makeReactor(
  opts: {
    botUsernames?: string[];
    comments?: MockLinearComment[];
    postShouldReturn?: string;
    postShouldThrow?: Error;
  } = {}
): LinearReactor {
  const mockComments: Partial<InstanceType<typeof LinearComments>> = {
    getComments: async () => opts.comments ?? [],
    postComment: async () => {
      if (opts.postShouldThrow) throw opts.postShouldThrow;
      return opts.postShouldReturn ?? 'comment-id-123';
    },
  };

  return new LinearReactor(
    mockComments as InstanceType<typeof LinearComments>,
    'issue-id-abc',
    opts.botUsernames ?? ['linear-bot']
  );
}

// --- isBotAuthor() ---

test('LinearReactor.isBotAuthor - returns true for the configured bot', () => {
  const reactor = makeReactor({ botUsernames: ['linear-bot'] });
  assert.equal(reactor.isBotAuthor('linear-bot'), true);
});

test('LinearReactor.isBotAuthor - returns false for a non-bot user', () => {
  const reactor = makeReactor({ botUsernames: ['linear-bot'] });
  assert.equal(reactor.isBotAuthor('human-user'), false);
  assert.equal(reactor.isBotAuthor(''), false);
});

test('LinearReactor.isBotAuthor - returns true for any bot in a multi-bot list', () => {
  const reactor = makeReactor({ botUsernames: ['bot-a', 'bot-b'] });
  assert.equal(reactor.isBotAuthor('bot-a'), true);
  assert.equal(reactor.isBotAuthor('bot-b'), true);
});

test('LinearReactor.isBotAuthor - comparison is case-insensitive', () => {
  const reactor = makeReactor({ botUsernames: ['LinearBot'] });
  assert.equal(reactor.isBotAuthor('linearbot'), true);
  assert.equal(reactor.isBotAuthor('LINEARBOT'), true);
  assert.equal(reactor.isBotAuthor('LinearBot'), true);
});

test('LinearReactor.isBotAuthor - empty list always returns false', () => {
  const reactor = makeReactor({ botUsernames: [] });
  assert.equal(reactor.isBotAuthor('anyone'), false);
});

// --- getLastComment() ---

test('LinearReactor.getLastComment - returns null when there are no comments', async () => {
  const reactor = makeReactor({ comments: [] });
  assert.equal(await reactor.getLastComment(), null);
});

test('LinearReactor.getLastComment - uses user.name (not displayName) as author', async () => {
  const reactor = makeReactor({
    comments: [
      {
        id: 'c1',
        body: 'Earlier comment',
        user: { id: 'u1', name: 'alice', email: 'alice@example.com', displayName: 'Alice Smith' },
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'c2',
        body: 'Last comment',
        user: { id: 'u2', name: 'bob', email: 'bob@example.com', displayName: 'Bob Jones' },
        createdAt: '2024-01-02T00:00:00Z',
      },
    ],
  });
  const result = await reactor.getLastComment();
  assert.ok(result !== null);
  assert.equal(result.author, 'bob'); // name, not 'Bob Jones'
  assert.equal(result.body, 'Last comment');
});

test('LinearReactor.getLastComment - propagates errors from comments API', async () => {
  const mockComments = {
    getComments: async () => {
      throw new Error('Linear API unavailable');
    },
  } as unknown as InstanceType<typeof LinearComments>;
  const reactor = new LinearReactor(mockComments, 'issue-id', []);
  await assert.rejects(() => reactor.getLastComment(), { message: 'Linear API unavailable' });
});

// --- postComment() ---

test('LinearReactor.postComment - returns the comment ID from the API', async () => {
  const reactor = makeReactor({ postShouldReturn: 'new-comment-id-456' });
  const result = await reactor.postComment('Hello Linear');
  assert.equal(result, 'new-comment-id-456');
});

test('LinearReactor.postComment - propagates errors from comments API', async () => {
  const reactor = makeReactor({ postShouldThrow: new Error('Linear API error') });
  await assert.rejects(() => reactor.postComment('A comment'), { message: 'Linear API error' });
});
