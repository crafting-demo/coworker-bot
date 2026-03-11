import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { GitHubWebhook } from '../src/watcher/providers/github/GitHubWebhook.js';

function makeSignature(secret: string, body: string | Buffer): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

function baseHeaders(): Record<string, string> {
  return {
    'x-github-event': 'issues',
    'x-github-delivery': 'abc-123',
  };
}

// --- validate() ---

test('GitHubWebhook.validate - missing X-GitHub-Event returns invalid', () => {
  const webhook = new GitHubWebhook();
  const result = webhook.validate({ 'x-github-delivery': 'abc' }, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('X-GitHub-Event'));
});

test('GitHubWebhook.validate - missing X-GitHub-Delivery returns invalid', () => {
  const webhook = new GitHubWebhook();
  const result = webhook.validate({ 'x-github-event': 'issues' }, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('X-GitHub-Delivery'));
});

test('GitHubWebhook.validate - valid when no secret is configured (no signature check)', () => {
  const webhook = new GitHubWebhook();
  const result = webhook.validate(baseHeaders(), '{"action":"opened"}');
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('GitHubWebhook.validate - valid with correct HMAC signature', () => {
  const secret = 'my-webhook-secret';
  const body = '{"action":"opened"}';
  const webhook = new GitHubWebhook(secret);
  const headers = { ...baseHeaders(), 'x-hub-signature-256': makeSignature(secret, body) };
  const result = webhook.validate(headers, body);
  assert.equal(result.valid, true);
});

test('GitHubWebhook.validate - missing signature header when secret is configured returns invalid', () => {
  const webhook = new GitHubWebhook('my-secret');
  const result = webhook.validate(baseHeaders(), 'body');
  assert.equal(result.valid, false);
  assert.ok(
    result.error?.toLowerCase().includes('signature') || result.error?.includes('X-Hub-Signature')
  );
});

test('GitHubWebhook.validate - incorrect HMAC signature returns invalid', () => {
  const webhook = new GitHubWebhook('my-secret');
  const headers = { ...baseHeaders(), 'x-hub-signature-256': 'sha256=deadbeef' };
  const result = webhook.validate(headers, '{"action":"opened"}');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('signature'));
});

test('GitHubWebhook.validate - signature without sha256= prefix is rejected', () => {
  const webhook = new GitHubWebhook('my-secret');
  const body = 'body';
  const rawSig = createHmac('sha256', 'my-secret').update(body).digest('hex');
  // Provide the raw hex without the required "sha256=" prefix
  const headers = { ...baseHeaders(), 'x-hub-signature-256': rawSig };
  const result = webhook.validate(headers, body);
  assert.equal(result.valid, false);
});

test('GitHubWebhook.validate - valid with Buffer body', () => {
  const secret = 'test-secret';
  const body = Buffer.from('{"action":"created"}');
  const webhook = new GitHubWebhook(secret);
  const headers = { ...baseHeaders(), 'x-hub-signature-256': makeSignature(secret, body) };
  const result = webhook.validate(headers, body);
  assert.equal(result.valid, true);
});

test('GitHubWebhook.validate - accepts array-valued headers (uses first value)', () => {
  const webhook = new GitHubWebhook();
  const result = webhook.validate(
    {
      'x-github-event': ['issues', 'push'],
      'x-github-delivery': ['delivery-123'],
    },
    'body'
  );
  assert.equal(result.valid, true);
});

// --- extractMetadata() ---

test('GitHubWebhook.extractMetadata - returns event type and delivery id', () => {
  const webhook = new GitHubWebhook();
  const meta = webhook.extractMetadata({
    'x-github-event': 'pull_request',
    'x-github-delivery': 'delivery-xyz',
  });
  assert.equal(meta.event, 'pull_request');
  assert.equal(meta.deliveryId, 'delivery-xyz');
});

test('GitHubWebhook.extractMetadata - throws when required headers are missing', () => {
  const webhook = new GitHubWebhook();
  assert.throws(() => webhook.extractMetadata({}), /Missing required/);
});
