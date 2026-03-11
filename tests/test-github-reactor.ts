import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubReactor } from '../src/watcher/providers/github/GitHubReactor.js';
import type {
  GitHubComments,
  CommentInfo,
} from '../src/watcher/providers/github/GitHubComments.js';

function makeReactor(
  opts: {
    botUsernames?: string[];
    lastComment?: CommentInfo | null;
    postShouldThrow?: Error;
  } = {}
): GitHubReactor {
  const mockComments: Partial<InstanceType<typeof GitHubComments>> = {
    getLastComment: async () => opts.lastComment ?? null,
    postComment: async () => {
      if (opts.postShouldThrow) throw opts.postShouldThrow;
    },
    listComments: async () => [],
  };

  return new GitHubReactor(
    mockComments as InstanceType<typeof GitHubComments>,
    'owner/repo',
    'issue',
    42,
    opts.botUsernames ?? ['my-bot']
  );
}

// --- isBotAuthor() ---

test('GitHubReactor.isBotAuthor - returns true for a configured bot username', () => {
  const reactor = makeReactor({ botUsernames: ['my-bot'] });
  assert.equal(reactor.isBotAuthor('my-bot'), true);
});

test('GitHubReactor.isBotAuthor - returns true for any bot in a multi-bot list', () => {
  const reactor = makeReactor({ botUsernames: ['bot-a', 'bot-b'] });
  assert.equal(reactor.isBotAuthor('bot-a'), true);
  assert.equal(reactor.isBotAuthor('bot-b'), true);
});

test('GitHubReactor.isBotAuthor - returns false for a non-bot username', () => {
  const reactor = makeReactor({ botUsernames: ['my-bot'] });
  assert.equal(reactor.isBotAuthor('human-user'), false);
  assert.equal(reactor.isBotAuthor(''), false);
});

test('GitHubReactor.isBotAuthor - comparison is case-insensitive', () => {
  const reactor = makeReactor({ botUsernames: ['MyBot'] });
  assert.equal(reactor.isBotAuthor('mybot'), true);
  assert.equal(reactor.isBotAuthor('MYBOT'), true);
  assert.equal(reactor.isBotAuthor('MyBot'), true);
});

test('GitHubReactor.isBotAuthor - always returns false with empty bot list', () => {
  const reactor = makeReactor({ botUsernames: [] });
  assert.equal(reactor.isBotAuthor('anyone'), false);
});

// --- getLastComment() ---

test('GitHubReactor.getLastComment - returns null when no comment exists', async () => {
  const reactor = makeReactor({ lastComment: null });
  assert.equal(await reactor.getLastComment(), null);
});

test('GitHubReactor.getLastComment - returns comment author and body', async () => {
  const reactor = makeReactor({
    lastComment: { author: 'alice', body: 'Hello!', createdAt: new Date() },
  });
  const result = await reactor.getLastComment();
  assert.ok(result !== null);
  assert.equal(result.author, 'alice');
  assert.equal(result.body, 'Hello!');
});

// --- postComment() ---

test('GitHubReactor.postComment - resolves to empty string on success', async () => {
  const reactor = makeReactor();
  const result = await reactor.postComment('A comment');
  assert.equal(result, '');
});

test('GitHubReactor.postComment - propagates errors thrown by the comments API', async () => {
  const reactor = makeReactor({ postShouldThrow: new Error('API 403 Forbidden') });
  await assert.rejects(() => reactor.postComment('A comment'), { message: 'API 403 Forbidden' });
});
