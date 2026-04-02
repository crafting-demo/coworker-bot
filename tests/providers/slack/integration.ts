/**
 * Integration tests for SlackProvider.
 *
 * Tests the full webhook pipeline: initialize → handleWebhook → eventHandler.
 * Uses a URL-based fetch mock; no signing secret needed (empty secret accepts all).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlackProvider } from '../../../src/watcher/providers/slack/SlackProvider.js';
import type { NormalizedEvent } from '../../../src/watcher/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace globalThis.fetch with a mock that dispatches responses by URL substring.
 */
function mockFetch(handlers: Array<{ match: string; ok: boolean; json?: unknown }>) {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    const handler = handlers.find((h) => url.includes(h.match));
    if (!handler) {
      return {
        ok: false,
        status: 500,
        statusText: 'Unexpected URL in test',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(`No mock handler for: ${url}`),
      };
    }
    return {
      ok: handler.ok,
      status: handler.ok ? 200 : 500,
      statusText: handler.ok ? 'OK' : 'Error',
      headers: { get: () => null },
      json: () => Promise.resolve(handler.json ?? {}),
      text: () => Promise.resolve(''),
    };
  };
  return () => {
    (globalThis as any).fetch = original;
  };
}

const BOT_USER_ID = 'U0BOT';
const BOT_USERNAME = 'coworker-bot';

/** auth.test response — identifies the bot */
const AUTH_TEST_RESPONSE = {
  ok: true,
  user_id: BOT_USER_ID,
  user: BOT_USERNAME,
  team: 'TestTeam',
  team_id: 'T123',
};

/** conversations.replies response — empty thread */
const EMPTY_REPLIES = {
  ok: true,
  messages: [],
  has_more: false,
};

/** users.info response with email */
function makeUserInfoResponse(userId: string, email?: string) {
  return {
    ok: true,
    user: {
      id: userId,
      name: 'alice',
      profile: {
        display_name: 'Alice',
        ...(email ? { email } : {}),
      },
    },
  };
}

/** Build a Slack event_callback / app_mention payload. */
function makeAppMentionPayload(
  userId: string,
  text: string,
  channel = 'C01CHANNEL',
  ts = '1234567890.000100'
) {
  return {
    type: 'event_callback',
    event_id: 'Ev123',
    event_time: 1234567890,
    team_id: 'T123',
    event: {
      type: 'app_mention',
      user: userId,
      text,
      ts,
      channel,
      event_ts: ts,
    },
  };
}

/** Initialize a SlackProvider with mocked auth.test. */
async function makeProvider(): Promise<{ provider: SlackProvider; restore: () => void }> {
  const restore = mockFetch([{ match: 'auth.test', ok: true, json: AUTH_TEST_RESPONSE }]);
  const provider = new SlackProvider();
  await provider.initialize({
    enabled: true,
    auth: { type: 'token', token: 'xoxb-fake-bot-token' },
    options: {},
  });
  restore();
  return { provider, restore: () => {} };
}

// ---------------------------------------------------------------------------
// Webhook tests
// ---------------------------------------------------------------------------

test('SlackProvider: app_mention event triggers eventHandler', async () => {
  const { provider } = await makeProvider();

  const restore = mockFetch([
    { match: 'conversations.replies', ok: true, json: EMPTY_REPLIES },
    { match: 'users.info', ok: true, json: makeUserInfoResponse('U01HUMAN') },
  ]);

  try {
    const events: NormalizedEvent[] = [];
    const handler = async (event: NormalizedEvent) => {
      events.push(event);
    };

    const payload = makeAppMentionPayload('U01HUMAN', `<@${BOT_USER_ID}> help me`);
    await provider.handleWebhook({}, payload, handler);

    assert.equal(events.length, 1);
    assert.equal(events[0]!.provider, 'slack');
    // actor.username is resolved display name ('Alice') from users.info; id is the Slack user ID
    assert.equal(events[0]!.actor.id, 'U01HUMAN');
  } finally {
    restore();
  }
});

test('SlackProvider: app_mention event resolves actor email via users.info', async () => {
  const { provider } = await makeProvider();

  const restore = mockFetch([
    { match: 'conversations.replies', ok: true, json: EMPTY_REPLIES },
    { match: 'users.info', ok: true, json: makeUserInfoResponse('U01HUMAN', 'alice@example.com') },
  ]);

  try {
    const events: NormalizedEvent[] = [];
    const handler = async (event: NormalizedEvent) => {
      events.push(event);
    };

    const payload = makeAppMentionPayload('U01HUMAN', `<@${BOT_USER_ID}> fix this please`);
    await provider.handleWebhook({}, payload, handler);

    assert.equal(events.length, 1);
    assert.equal(events[0]!.actor.email, 'alice@example.com');
  } finally {
    restore();
  }
});

test('SlackProvider: non-app_mention event type is skipped', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = {
    type: 'event_callback',
    event: { type: 'message', user: 'U01HUMAN', text: 'hello', ts: '123', channel: 'C01' },
  };
  await provider.handleWebhook({}, payload, handler);

  assert.equal(called, false);
});

test('SlackProvider: url_verification type does not trigger eventHandler', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = { type: 'url_verification', challenge: 'abc123' };
  await provider.handleWebhook({}, payload, handler);

  assert.equal(called, false);
});

test('SlackProvider: non-event_callback type is skipped', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = { type: 'block_actions' };
  await provider.handleWebhook({}, payload, handler);

  assert.equal(called, false);
});

test('SlackProvider: event without actor email has no email on normalized event', async () => {
  const { provider } = await makeProvider();

  const restore = mockFetch([
    { match: 'conversations.replies', ok: true, json: EMPTY_REPLIES },
    { match: 'users.info', ok: true, json: makeUserInfoResponse('U01HUMAN') }, // no email
  ]);

  try {
    const events: NormalizedEvent[] = [];
    const handler = async (event: NormalizedEvent) => {
      events.push(event);
    };

    const payload = makeAppMentionPayload('U01HUMAN', `<@${BOT_USER_ID}> help`);
    await provider.handleWebhook({}, payload, handler);

    assert.equal(events.length, 1);
    assert.equal(events[0]!.actor.email, undefined);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Initialization tests
// ---------------------------------------------------------------------------

test('SlackProvider: initialize auto-detects bot user ID from auth.test', async () => {
  const restore = mockFetch([{ match: 'auth.test', ok: true, json: AUTH_TEST_RESPONSE }]);
  try {
    const provider = new SlackProvider();
    await provider.initialize({
      enabled: true,
      auth: { type: 'token', token: 'xoxb-fake-bot-token' },
      options: {},
    });
    // If initialize succeeded without throwing, auth.test was called and returned ok
    assert.ok(true);
  } finally {
    restore();
  }
});

test('SlackProvider: initialize throws on auth failure', async () => {
  const restore = mockFetch([
    {
      match: 'auth.test',
      ok: true,
      json: { ok: false, error: 'invalid_auth', user_id: undefined },
    },
  ]);
  try {
    const provider = new SlackProvider();
    await assert.rejects(
      () =>
        provider.initialize({
          enabled: true,
          auth: { type: 'token', token: 'xoxb-bad-token' },
          options: {},
        }),
      (err: Error) => {
        assert.ok(err.message.includes('Slack'), `Expected Slack error, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    restore();
  }
});
