/**
 * Integration tests for LinearProvider.
 *
 * Tests the full webhook pipeline: initialize → handleWebhook → eventHandler.
 * Uses a URL-based fetch mock; no webhook secret needed (empty secret accepts all).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinearProvider } from '../../../src/watcher/providers/linear/LinearProvider.js';
import type { NormalizedEvent } from '../../../src/watcher/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace globalThis.fetch with a mock that returns responses keyed by URL.
 * Falls back to a 500 error for unrecognised URLs.
 */
function mockFetch(handlers: Record<string, { ok: boolean; json?: unknown }>) {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => {
    const match = Object.entries(handlers).find(([key]) => url.includes(key));
    if (!match) {
      return {
        ok: false,
        status: 500,
        statusText: 'Unexpected URL',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(`No mock for ${url}`),
      };
    }
    const [, resp] = match;
    return {
      ok: resp.ok,
      status: resp.ok ? 200 : 500,
      statusText: resp.ok ? 'OK' : 'Error',
      headers: { get: () => null },
      json: () => Promise.resolve(resp.json ?? {}),
      text: () => Promise.resolve(''),
    };
  };
  return () => {
    (globalThis as any).fetch = original;
  };
}

/** Initialize a LinearProvider with a fake token and explicit botUsername (no auto-detect fetch). */
async function makeProvider(): Promise<{ provider: LinearProvider; restore: () => void }> {
  const provider = new LinearProvider();
  await provider.initialize({
    enabled: true,
    auth: { type: 'token', token: 'lin_api_fake' },
    options: { botUsername: 'coworker-bot' },
  });
  return { provider, restore: () => {} };
}

/** Minimal Linear-Delivery header needed for webhook processing. */
const WEBHOOK_HEADERS = { 'linear-delivery': 'test-delivery-id' };

/** Build a Linear issue webhook payload with the bot assigned. */
function makeIssuePayload(overrides: {
  assignee?: { id: string; name: string } | null;
  state?: string;
  actorEmail?: string;
}) {
  return {
    action: 'update',
    type: 'Issue',
    createdAt: new Date().toISOString(),
    actor: {
      id: 'actor-1',
      type: 'User',
      name: 'Alice',
      ...(overrides.actorEmail ? { email: overrides.actorEmail } : {}),
    },
    data: {
      id: 'issue-abc',
      identifier: 'ENG-42',
      number: 42,
      title: 'Fix the bug',
      description: 'It is broken.',
      url: 'https://linear.app/team/issue/ENG-42',
      state: { name: overrides.state ?? 'In Progress', type: 'started' },
      team: { key: 'ENG', name: 'Engineering' },
      assignee:
        overrides.assignee !== undefined
          ? (overrides.assignee ?? undefined)
          : { id: 'bot-1', name: 'coworker-bot' },
      creator: { name: 'Alice', email: 'alice@example.com' },
      labels: { nodes: [] },
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    updatedFrom: {},
  };
}

/** Build a Linear comment webhook payload with the bot mentioned. */
function makeCommentPayload(commentBody: string, actorEmail?: string) {
  return {
    action: 'create',
    type: 'Comment',
    createdAt: new Date().toISOString(),
    actor: {
      id: 'actor-2',
      type: 'User',
      name: 'Bob',
      ...(actorEmail ? { email: actorEmail } : {}),
    },
    data: {
      id: 'comment-xyz',
      body: commentBody,
      user: { id: 'actor-2', name: 'Bob' },
      issue: {
        id: 'issue-abc',
        identifier: 'ENG-42',
        number: 42,
        title: 'Fix the bug',
        description: 'It is broken.',
        url: 'https://linear.app/team/issue/ENG-42',
        state: { name: 'In Progress', type: 'started' },
        team: { key: 'ENG', name: 'Engineering' },
        assignee: { id: 'someone', name: 'Alice' },
        labels: { nodes: [] },
      },
      createdAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Issue webhook tests
// ---------------------------------------------------------------------------

test('LinearProvider: issue with bot assigned triggers eventHandler', async () => {
  const { provider } = await makeProvider();
  const events: NormalizedEvent[] = [];
  const handler = async (event: NormalizedEvent) => {
    events.push(event);
  };

  const payload = makeIssuePayload({});
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(events.length, 1);
  assert.equal(events[0]!.provider, 'linear');
  assert.equal(events[0]!.resource.title, 'Fix the bug');
  assert.equal(events[0]!.resource.number, 42);
  assert.equal(events[0]!.resource.repository, 'ENG');
});

test('LinearProvider: issue without bot assigned is skipped', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = makeIssuePayload({ assignee: { id: 'other', name: 'Alice' } });
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(called, false);
});

test('LinearProvider: issue in Done state is skipped', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = makeIssuePayload({ state: 'Done' });
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(called, false);
});

test('LinearProvider: issue event sets actor.email from payload.actor.email', async () => {
  const { provider } = await makeProvider();
  const events: NormalizedEvent[] = [];
  const handler = async (event: NormalizedEvent) => {
    events.push(event);
  };

  const payload = makeIssuePayload({ actorEmail: 'alice@example.com' });
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(events.length, 1);
  assert.equal(events[0]!.actor.email, 'alice@example.com');
});

test('LinearProvider: issue event without actor email has no email on actor', async () => {
  const { provider } = await makeProvider();
  const events: NormalizedEvent[] = [];
  const handler = async (event: NormalizedEvent) => {
    events.push(event);
  };

  const payload = makeIssuePayload({});
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(events.length, 1);
  assert.equal(events[0]!.actor.email, undefined);
});

// ---------------------------------------------------------------------------
// Comment webhook tests
// ---------------------------------------------------------------------------

test('LinearProvider: comment mentioning bot triggers eventHandler', async () => {
  const { provider } = await makeProvider();
  const events: NormalizedEvent[] = [];
  const handler = async (event: NormalizedEvent) => {
    events.push(event);
  };

  const payload = makeCommentPayload('@coworker-bot please fix this');
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(events.length, 1);
  assert.equal(events[0]!.action, 'comment');
  assert.equal(events[0]!.resource.comment?.body, '@coworker-bot please fix this');
  assert.equal(events[0]!.resource.comment?.author, 'Bob');
});

test('LinearProvider: comment with action update is skipped even if bot is mentioned', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = { ...makeCommentPayload('@coworker-bot fix this'), action: 'update' };
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(called, false);
});

test('LinearProvider: comment with action remove is skipped even if bot is mentioned', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = { ...makeCommentPayload('@coworker-bot fix this'), action: 'remove' };
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(called, false);
});

test('LinearProvider: comment NOT mentioning bot is skipped', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = makeCommentPayload('just a regular comment');
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(called, false);
});

test('LinearProvider: comment event sets actor.email from payload.actor.email', async () => {
  const { provider } = await makeProvider();
  const events: NormalizedEvent[] = [];
  const handler = async (event: NormalizedEvent) => {
    events.push(event);
  };

  const payload = makeCommentPayload('@coworker-bot help', 'bob@example.com');
  await provider.handleWebhook(WEBHOOK_HEADERS, payload, handler);

  assert.equal(events.length, 1);
  assert.equal(events[0]!.actor.email, 'bob@example.com');
});

// ---------------------------------------------------------------------------
// Poll tests
// ---------------------------------------------------------------------------

test('LinearProvider: poll triggers eventHandler for issue with bot assigned', async () => {
  const provider = new LinearProvider();
  // Need to mock the GraphQL call for poll (LinearPoller uses fetch)
  // Use botUsername to skip auto-detect, but poll still hits the API
  const pollResponse = {
    data: {
      issues: {
        nodes: [
          {
            id: 'issue-abc',
            identifier: 'ENG-42',
            number: 42,
            title: 'Polled issue',
            description: 'From poll.',
            url: 'https://linear.app/team/issue/ENG-42',
            state: { name: 'In Progress', type: 'started' },
            team: { key: 'ENG', name: 'Engineering' },
            assignee: { name: 'coworker-bot', email: null },
            creator: { name: 'Alice', email: 'alice@example.com' },
            labels: { nodes: [] },
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };

  const restore = mockFetch({
    'api.linear.app/graphql': { ok: true, json: pollResponse },
  });

  try {
    await provider.initialize({
      enabled: true,
      pollingInterval: 60,
      auth: { type: 'token', token: 'lin_api_fake' },
      options: { botUsername: 'coworker-bot' },
    });

    const events: NormalizedEvent[] = [];
    const handler = async (event: NormalizedEvent) => {
      events.push(event);
    };

    await provider.poll(handler);

    assert.equal(events.length, 1);
    assert.equal(events[0]!.provider, 'linear');
    assert.equal(events[0]!.action, 'poll');
    assert.equal(events[0]!.resource.title, 'Polled issue');
  } finally {
    restore();
  }
});

test('LinearProvider: poll skips issue where bot is not assigned', async () => {
  const provider = new LinearProvider();
  const pollResponse = {
    data: {
      issues: {
        nodes: [
          {
            id: 'issue-xyz',
            identifier: 'ENG-99',
            number: 99,
            title: 'Unassigned issue',
            description: '',
            url: 'https://linear.app/team/issue/ENG-99',
            state: { name: 'In Progress', type: 'started' },
            team: { key: 'ENG', name: 'Engineering' },
            assignee: { name: 'Alice', email: null },
            creator: { name: 'Bob', email: null },
            labels: { nodes: [] },
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };

  const restore = mockFetch({
    'api.linear.app/graphql': { ok: true, json: pollResponse },
  });

  try {
    await provider.initialize({
      enabled: true,
      pollingInterval: 60,
      auth: { type: 'token', token: 'lin_api_fake' },
      options: { botUsername: 'coworker-bot' },
    });

    let called = false;
    const handler = async () => {
      called = true;
    };

    await provider.poll(handler);
    assert.equal(called, false);
  } finally {
    restore();
  }
});
