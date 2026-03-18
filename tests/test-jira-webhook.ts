import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JiraWebhook } from '../src/watcher/providers/jira/JiraWebhook.js';

// Jira system webhooks do not use HMAC signing; we validate an optional
// shared secret passed in the X-Jira-Webhook-Token header.

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

test('JiraWebhook.validate - valid with correct token header', () => {
  const webhook = new JiraWebhook('my-secret-token');
  const headers = { ...baseHeaders(), 'x-jira-webhook-token': 'my-secret-token' };
  const result = webhook.validate(headers, '{}');
  assert.equal(result.valid, true);
});

test('JiraWebhook.validate - invalid when secret configured but token header is missing', () => {
  const webhook = new JiraWebhook('my-secret-token');
  const result = webhook.validate(baseHeaders(), '{}');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('x-jira-webhook-token'));
});

test('JiraWebhook.validate - invalid when token does not match secret', () => {
  const webhook = new JiraWebhook('correct-token');
  const headers = { ...baseHeaders(), 'x-jira-webhook-token': 'wrong-token' };
  const result = webhook.validate(headers, '{}');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('token'));
});

test('JiraWebhook.validate - token comparison is case-sensitive', () => {
  const webhook = new JiraWebhook('MySecret');
  const headers = { ...baseHeaders(), 'x-jira-webhook-token': 'mysecret' };
  const result = webhook.validate(headers, '{}');
  assert.equal(result.valid, false);
});

test('JiraWebhook.validate - accepts array-valued token header (uses first value)', () => {
  const webhook = new JiraWebhook('tok');
  const result = webhook.validate({ 'x-jira-webhook-token': ['tok', 'other'] }, 'body');
  assert.equal(result.valid, true);
});

test('JiraWebhook.validate - rawBody parameter is ignored (Jira does not use HMAC)', () => {
  const webhook = new JiraWebhook('tok');
  // Same token, different bodies — both should behave the same
  const headers = { 'x-jira-webhook-token': 'tok' };
  assert.equal(webhook.validate(headers, 'body-a').valid, true);
  assert.equal(webhook.validate(headers, 'body-b').valid, true);
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
