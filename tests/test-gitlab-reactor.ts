import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitLabReactor } from '../src/watcher/providers/gitlab/GitLabReactor.js';
import type { GitLabComments } from '../src/watcher/providers/gitlab/GitLabComments.js';

interface MockComment {
  id: number;
  body: string;
  author: { username: string };
  created_at: string;
}

function makeReactor(
  opts: {
    botUsernames?: string[];
    comments?: MockComment[];
    postShouldReturn?: number;
    postShouldThrow?: Error;
  } = {}
): GitLabReactor {
  const mockComments: Partial<InstanceType<typeof GitLabComments>> = {
    getComments: async () => opts.comments ?? [],
    postComment: async () => {
      if (opts.postShouldThrow) throw opts.postShouldThrow;
      return opts.postShouldReturn ?? 99;
    },
    listNotes: async () => [],
  };

  return new GitLabReactor(
    mockComments as InstanceType<typeof GitLabComments>,
    'group/project',
    'issue',
    7,
    opts.botUsernames ?? ['gitlab-bot']
  );
}

// --- isBotAuthor() ---

test('GitLabReactor.isBotAuthor - returns true for the configured bot', () => {
  const reactor = makeReactor({ botUsernames: ['gitlab-bot'] });
  assert.equal(reactor.isBotAuthor('gitlab-bot'), true);
});

test('GitLabReactor.isBotAuthor - returns false for a non-bot user', () => {
  const reactor = makeReactor({ botUsernames: ['gitlab-bot'] });
  assert.equal(reactor.isBotAuthor('human'), false);
});

test('GitLabReactor.isBotAuthor - returns true for any bot in a multi-bot list', () => {
  const reactor = makeReactor({ botUsernames: ['bot-a', 'bot-b'] });
  assert.equal(reactor.isBotAuthor('bot-a'), true);
  assert.equal(reactor.isBotAuthor('bot-b'), true);
});

test('GitLabReactor.isBotAuthor - comparison is case-insensitive', () => {
  const reactor = makeReactor({ botUsernames: ['GitlabBot'] });
  assert.equal(reactor.isBotAuthor('gitlabbot'), true);
  assert.equal(reactor.isBotAuthor('GITLABBOT'), true);
  assert.equal(reactor.isBotAuthor('GitlabBot'), true);
});

test('GitLabReactor.isBotAuthor - empty list always returns false', () => {
  const reactor = makeReactor({ botUsernames: [] });
  assert.equal(reactor.isBotAuthor('anyone'), false);
});

// --- getLastComment() ---

test('GitLabReactor.getLastComment - returns null when there are no comments', async () => {
  const reactor = makeReactor({ comments: [] });
  assert.equal(await reactor.getLastComment(), null);
});

test('GitLabReactor.getLastComment - returns the last comment author and body', async () => {
  const reactor = makeReactor({
    comments: [
      { id: 1, body: 'First', author: { username: 'alice' }, created_at: '2024-01-01' },
      { id: 2, body: 'Second', author: { username: 'bob' }, created_at: '2024-01-02' },
    ],
  });
  const result = await reactor.getLastComment();
  assert.ok(result !== null);
  assert.equal(result.author, 'bob');
  assert.equal(result.body, 'Second');
});

test('GitLabReactor.getLastComment - propagates errors from comments API', async () => {
  const mockComments = {
    getComments: async () => {
      throw new Error('GitLab API down');
    },
  } as unknown as InstanceType<typeof GitLabComments>;
  const reactor = new GitLabReactor(mockComments, 'g/p', 'issue', 1, []);
  await assert.rejects(() => reactor.getLastComment(), { message: 'GitLab API down' });
});

// --- postComment() ---

test('GitLabReactor.postComment - returns the comment ID as a string', async () => {
  const reactor = makeReactor({ postShouldReturn: 42 });
  const result = await reactor.postComment('My comment');
  assert.equal(result, '42');
});

test('GitLabReactor.postComment - propagates errors from comments API', async () => {
  const reactor = makeReactor({ postShouldThrow: new Error('GitLab 403') });
  await assert.rejects(() => reactor.postComment('A comment'), { message: 'GitLab 403' });
});
