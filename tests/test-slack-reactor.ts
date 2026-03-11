import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlackReactor } from '../src/watcher/providers/slack/SlackReactor.js';
import type { SlackComments } from '../src/watcher/providers/slack/SlackComments.js';

function makeReactor(
  opts: {
    botUsernames?: string[];
    lastMessage?: { user: string; text: string } | null;
    postShouldReturn?: string;
    postShouldThrow?: Error;
    channel?: string;
    threadTs?: string;
  } = {}
): SlackReactor {
  const mockComments: Partial<InstanceType<typeof SlackComments>> = {
    getLastMessage: async () => opts.lastMessage ?? null,
    postMessage: async () => {
      if (opts.postShouldThrow) throw opts.postShouldThrow;
      return opts.postShouldReturn ?? '1609459200.000100';
    },
  };

  return new SlackReactor(
    mockComments as InstanceType<typeof SlackComments>,
    opts.channel ?? 'C01234567',
    opts.threadTs,
    opts.botUsernames ?? ['slack-bot']
  );
}

// --- isBotAuthor() ---

test('SlackReactor.isBotAuthor - returns true for the configured bot', () => {
  const reactor = makeReactor({ botUsernames: ['slack-bot'] });
  assert.equal(reactor.isBotAuthor('slack-bot'), true);
});

test('SlackReactor.isBotAuthor - returns false for a non-bot user', () => {
  const reactor = makeReactor({ botUsernames: ['slack-bot'] });
  assert.equal(reactor.isBotAuthor('U987654'), false);
  assert.equal(reactor.isBotAuthor(''), false);
});

test('SlackReactor.isBotAuthor - returns true for any bot in a multi-bot list', () => {
  const reactor = makeReactor({ botUsernames: ['bot-a', 'bot-b'] });
  assert.equal(reactor.isBotAuthor('bot-a'), true);
  assert.equal(reactor.isBotAuthor('bot-b'), true);
});

test('SlackReactor.isBotAuthor - comparison is case-insensitive', () => {
  const reactor = makeReactor({ botUsernames: ['SlackBot'] });
  assert.equal(reactor.isBotAuthor('slackbot'), true);
  assert.equal(reactor.isBotAuthor('SLACKBOT'), true);
  assert.equal(reactor.isBotAuthor('SlackBot'), true);
});

test('SlackReactor.isBotAuthor - empty list always returns false', () => {
  const reactor = makeReactor({ botUsernames: [] });
  assert.equal(reactor.isBotAuthor('anyone'), false);
});

// --- getLastComment() ---

test('SlackReactor.getLastComment - returns null when there are no messages', async () => {
  const reactor = makeReactor({ lastMessage: null });
  assert.equal(await reactor.getLastComment(), null);
});

test('SlackReactor.getLastComment - maps Slack user and text to author and body', async () => {
  const reactor = makeReactor({
    lastMessage: { user: 'U12345', text: 'Hello from Slack' },
  });
  const result = await reactor.getLastComment();
  assert.ok(result !== null);
  assert.equal(result.author, 'U12345');
  assert.equal(result.body, 'Hello from Slack');
});

test('SlackReactor.getLastComment - propagates errors from Slack API', async () => {
  const mockComments = {
    getLastMessage: async () => {
      throw new Error('channel_not_found');
    },
  } as unknown as InstanceType<typeof SlackComments>;
  const reactor = new SlackReactor(mockComments, 'C999', undefined, []);
  await assert.rejects(() => reactor.getLastComment(), { message: 'channel_not_found' });
});

// --- postComment() ---

test('SlackReactor.postComment - returns "channel:ts" composite ID', async () => {
  const reactor = makeReactor({
    channel: 'C01234567',
    postShouldReturn: '1609459200.000100',
  });
  const result = await reactor.postComment('Hello Slack');
  assert.equal(result, 'C01234567:1609459200.000100');
});

test('SlackReactor.postComment - composite ID uses the reactor channel', async () => {
  const reactor = makeReactor({
    channel: 'C09999999',
    postShouldReturn: '9999.000001',
  });
  const result = await reactor.postComment('Test');
  assert.equal(result, 'C09999999:9999.000001');
});

test('SlackReactor.postComment - propagates errors from Slack API', async () => {
  const reactor = makeReactor({ postShouldThrow: new Error('channel_not_found') });
  await assert.rejects(() => reactor.postComment('Hello'), { message: 'channel_not_found' });
});
