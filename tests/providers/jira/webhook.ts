import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { JiraWebhook } from '../../../src/watcher/providers/jira/JiraWebhook.js';

// Jira Cloud signs webhook payloads with HMAC-SHA256 in the X-Hub-Signature header:
//   X-Hub-Signature: sha256=<hex>

function sign(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function baseHeaders(): Record<string, string> {
  return { 'x-atlassian-token': 'no-check' };
}

// --- validate() ---

test('JiraWebhook.validate - valid when no secret is configured (accept all)', () => {
  const webhook = new JiraWebhook();
  const result = webhook.validate(baseHeaders(), '{"webhookEvent":"jira:issue_created"}');
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('JiraWebhook.validate - valid when no secret and no headers', () => {
  const webhook = new JiraWebhook();
  const result = webhook.validate({}, 'body');
  assert.equal(result.valid, true);
});

test('JiraWebhook.validate - valid with correct HMAC signature', () => {
  const secret = 'my-secret';
  const body = '{"webhookEvent":"jira:issue_created"}';
  const webhook = new JiraWebhook(secret);
  const headers = { ...baseHeaders(), 'x-hub-signature': sign(secret, body) };
  const result = webhook.validate(headers, body);
  assert.equal(result.valid, true);
});

test('JiraWebhook.validate - invalid when secret configured but X-Hub-Signature header is missing', () => {
  const webhook = new JiraWebhook('my-secret');
  const result = webhook.validate(baseHeaders(), '{}');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('x-hub-signature'));
});

test('JiraWebhook.validate - invalid when signature does not match', () => {
  const webhook = new JiraWebhook('correct-secret');
  const headers = { ...baseHeaders(), 'x-hub-signature': sign('wrong-secret', '{}') };
  const result = webhook.validate(headers, '{}');
  assert.equal(result.valid, false);
  assert.ok(
    result.error?.toLowerCase().includes('signature') ||
      result.error?.toLowerCase().includes('mismatch')
  );
});

test('JiraWebhook.validate - invalid when X-Hub-Signature header is malformed (no = sign)', () => {
  const webhook = new JiraWebhook('secret');
  const headers = { ...baseHeaders(), 'x-hub-signature': 'invalidsignature' };
  const result = webhook.validate(headers, '{}');
  assert.equal(result.valid, false);
});

test('JiraWebhook.validate - accepts array-valued X-Hub-Signature header (uses first value)', () => {
  const secret = 'tok';
  const body = 'body';
  const sig = sign(secret, body);
  const webhook = new JiraWebhook(secret);
  const result = webhook.validate({ 'x-hub-signature': [sig, 'other'] }, body);
  assert.equal(result.valid, true);
});

test('JiraWebhook.validate - signature depends on rawBody (different body = invalid)', () => {
  const secret = 'tok';
  const body = 'body-a';
  const webhook = new JiraWebhook(secret);
  const headers = { 'x-hub-signature': sign(secret, body) };
  // Correct body passes
  assert.equal(webhook.validate(headers, 'body-a').valid, true);
  // Different body fails
  assert.equal(webhook.validate(headers, 'body-b').valid, false);
});

// --- extractMetadata() ---

test('JiraWebhook.extractMetadata - returns a deliveryId string', () => {
  const webhook = new JiraWebhook();
  const meta = webhook.extractMetadata({ 'x-atlassian-event-source-info': 'src-abc-123' });
  assert.equal(meta.deliveryId, 'src-abc-123');
});

test('JiraWebhook.extractMetadata - falls back to timestamp string when header absent', () => {
  const webhook = new JiraWebhook();
  const before = Date.now();
  const meta = webhook.extractMetadata({});
  const after = Date.now();
  const ts = parseInt(meta.deliveryId, 10);
  assert.ok(!isNaN(ts), 'deliveryId should be numeric when falling back to timestamp');
  assert.ok(ts >= before && ts <= after, 'deliveryId should be within the call window');
});
