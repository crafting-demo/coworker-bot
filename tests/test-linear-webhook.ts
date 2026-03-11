import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LinearWebhook } from '../src/watcher/providers/linear/LinearWebhook.js';

// Linear uses raw HMAC SHA-256 hex — no prefix like GitHub's "sha256="
function makeSignature(secret: string, body: string | Buffer): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  return hmac.digest('hex');
}

function baseHeaders(): Record<string, string> {
  return { 'linear-delivery': 'delivery-abc-123' };
}

// --- validate() ---

test('LinearWebhook.validate - missing Linear-Delivery header returns invalid', () => {
  const webhook = new LinearWebhook();
  const result = webhook.validate({}, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('Linear-Delivery'));
});

test('LinearWebhook.validate - valid when no secret is configured', () => {
  const webhook = new LinearWebhook();
  const result = webhook.validate(baseHeaders(), '{"action":"create"}');
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('LinearWebhook.validate - valid with correct HMAC signature', () => {
  const secret = 'linear-signing-secret';
  const body = '{"action":"create","type":"Issue"}';
  const webhook = new LinearWebhook(secret);
  const headers = { ...baseHeaders(), 'linear-signature': makeSignature(secret, body) };
  const result = webhook.validate(headers, body);
  assert.equal(result.valid, true);
});

test('LinearWebhook.validate - missing signature header when secret is configured returns invalid', () => {
  const webhook = new LinearWebhook('my-secret');
  const result = webhook.validate(baseHeaders(), 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('Linear-Signature'));
});

test('LinearWebhook.validate - incorrect HMAC signature returns invalid', () => {
  const webhook = new LinearWebhook('my-secret');
  const headers = { ...baseHeaders(), 'linear-signature': 'deadbeef' };
  const result = webhook.validate(headers, '{"action":"create"}');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('signature'));
});

test('LinearWebhook.validate - wrong-length signature is rejected without throwing', () => {
  const webhook = new LinearWebhook('my-secret');
  const headers = { ...baseHeaders(), 'linear-signature': 'abc' };
  const result = webhook.validate(headers, 'body');
  assert.equal(result.valid, false);
});

test('LinearWebhook.validate - signature for wrong secret is rejected', () => {
  const body = '{"action":"update"}';
  const webhook = new LinearWebhook('correct-secret');
  const headers = { ...baseHeaders(), 'linear-signature': makeSignature('wrong-secret', body) };
  const result = webhook.validate(headers, body);
  assert.equal(result.valid, false);
});

test('LinearWebhook.validate - valid with Buffer body', () => {
  const secret = 'test-secret';
  const body = Buffer.from('{"action":"update"}');
  const webhook = new LinearWebhook(secret);
  const headers = { ...baseHeaders(), 'linear-signature': makeSignature(secret, body) };
  const result = webhook.validate(headers, body);
  assert.equal(result.valid, true);
});

test('LinearWebhook.validate - accepts array-valued headers', () => {
  const webhook = new LinearWebhook();
  const result = webhook.validate({ 'linear-delivery': ['delivery-1', 'delivery-2'] }, 'body');
  assert.equal(result.valid, true);
});

// --- extractMetadata() ---

test('LinearWebhook.extractMetadata - returns webhookId from delivery header', () => {
  const webhook = new LinearWebhook();
  const meta = webhook.extractMetadata({ 'linear-delivery': 'wh-id-xyz' });
  assert.equal(meta.webhookId, 'wh-id-xyz');
});

test('LinearWebhook.extractMetadata - throws when delivery header is missing', () => {
  const webhook = new LinearWebhook();
  assert.throws(() => webhook.extractMetadata({}), /Missing required/);
});
