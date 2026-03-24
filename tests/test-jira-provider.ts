import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JiraProvider } from '../src/watcher/providers/jira/JiraProvider.js';
import type { JiraWebhookPayload } from '../src/watcher/providers/jira/JiraNormalizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(responses: Array<{ ok: boolean; json?: unknown; status?: number }>) {
  let call = 0;
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    const resp = responses[call++] ?? responses[responses.length - 1]!;
    return {
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 500),
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

const BOT_ACCOUNT_ID = 'bot-account-id-123';
const BOT_DISPLAY_NAME = 'Coworker Bot';
const HUMAN_ACCOUNT_ID = 'human-account-id-456';

async function makeProvider(): Promise<{ provider: JiraProvider; restore: () => void }> {
  // getAuthenticatedUser() is called during initialize()
  const restore = mockFetch([
    { ok: true, json: { accountId: BOT_ACCOUNT_ID, displayName: BOT_DISPLAY_NAME } },
  ]);
  const provider = new JiraProvider();
  await provider.initialize({
    enabled: true,
    auth: { type: 'token', token: 'test-token' },
    options: { baseUrl: 'https://test.atlassian.net' },
  });
  restore();
  return { provider, restore: () => {} };
}

function makeCommentPayload(
  authorAccountId: string,
  authorDisplayName: string,
  commentBody: string
): JiraWebhookPayload {
  return {
    timestamp: Date.now(),
    webhookEvent: 'comment_created',
    issue: {
      id: '10001',
      key: 'PROJ-1',
      self: 'https://test.atlassian.net/rest/api/3/issue/10001',
      fields: {
        summary: 'Test issue',
        status: { name: 'In Progress' },
        project: { key: 'PROJ', name: 'Project' },
      },
    },
    comment: {
      id: 'comment-1',
      self: 'https://test.atlassian.net/rest/api/3/issue/10001/comment/comment-1',
      author: { accountId: authorAccountId, displayName: authorDisplayName },
      body: commentBody,
      created: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// JiraProvider.handleWebhook — bot self-comment filtering
// ---------------------------------------------------------------------------

test('JiraProvider: skips comment_created event authored by the bot (matched by accountId)', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = makeCommentPayload(
    BOT_ACCOUNT_ID,
    'Some Display Name',
    `@${BOT_DISPLAY_NAME} please fix this`
  );

  await provider.handleWebhook({}, payload, handler);
  assert.equal(called, false, 'handler should not be called for bot-authored comments');
});

test('JiraProvider: skips comment_created event authored by the bot (matched by displayName)', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = makeCommentPayload(
    'some-other-account-id',
    BOT_DISPLAY_NAME, // display name matches
    `@${BOT_DISPLAY_NAME} please continue`
  );

  await provider.handleWebhook({}, payload, handler);
  assert.equal(called, false, 'handler should not be called when displayName matches bot');
});

test('JiraProvider: processes comment_created event authored by a human mentioning the bot', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = makeCommentPayload(
    HUMAN_ACCOUNT_ID,
    'Alice',
    `@${BOT_DISPLAY_NAME} please fix this`
  );

  await provider.handleWebhook({}, payload, handler);
  assert.equal(called, true, 'handler should be called for human comments mentioning the bot');
});

test('JiraProvider: skips comment_created event from a human that does not mention the bot', async () => {
  const { provider } = await makeProvider();
  let called = false;
  const handler = async () => {
    called = true;
  };

  const payload = makeCommentPayload(HUMAN_ACCOUNT_ID, 'Alice', 'just a regular comment');

  await provider.handleWebhook({}, payload, handler);
  assert.equal(called, false, 'handler should not be called when bot is not mentioned');
});
