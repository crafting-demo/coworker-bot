import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { SlackWebhook } from '../src/watcher/providers/slack/SlackWebhook.js';

// Slack uses: v0=HMAC-SHA256("v0:<timestamp>:<body>")
function makeSlackSignature(secret: string, timestamp: string, body: string): string {
  const basestring = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', secret);
  hmac.update(basestring);
  return `v0=${hmac.digest('hex')}`;
}

function freshTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

// --- URL verification challenge ---

test('SlackWebhook.validate - returns challenge for url_verification type', () => {
  const webhook = new SlackWebhook();
  const result = webhook.validate({}, { type: 'url_verification', challenge: 'abc123' }, '');
  assert.equal(result.valid, true);
  assert.equal(result.challenge, 'abc123');
});

test('SlackWebhook.validate - url_verification without challenge returns invalid', () => {
  const webhook = new SlackWebhook();
  const result = webhook.validate({}, { type: 'url_verification' }, '');
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('challenge'));
});

// --- No secret configured ---

test('SlackWebhook.validate - valid when no signing secret is configured', () => {
  const webhook = new SlackWebhook();
  const result = webhook.validate({}, { type: 'event_callback' }, '{"type":"event_callback"}');
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

// --- Signature verification ---

test('SlackWebhook.validate - valid with correct v0= signature', () => {
  const secret = 'slack-signing-secret';
  const body = '{"type":"event_callback"}';
  const ts = freshTimestamp();
  const webhook = new SlackWebhook(secret);
  const headers = {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': makeSlackSignature(secret, ts, body),
  };
  const result = webhook.validate(headers, { type: 'event_callback' }, body);
  assert.equal(result.valid, true);
});

test('SlackWebhook.validate - missing timestamp header when secret is configured returns invalid', () => {
  const webhook = new SlackWebhook('my-secret');
  const result = webhook.validate({ 'x-slack-signature': 'v0=deadbeef' }, {}, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('timestamp'));
});

test('SlackWebhook.validate - missing signature header when secret is configured returns invalid', () => {
  const webhook = new SlackWebhook('my-secret');
  const result = webhook.validate({ 'x-slack-request-timestamp': freshTimestamp() }, {}, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('signature'));
});

test('SlackWebhook.validate - replay attack: timestamp older than 5 minutes is rejected', () => {
  const secret = 'slack-secret';
  const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 400 s ago
  const body = 'body';
  const webhook = new SlackWebhook(secret);
  const headers = {
    'x-slack-request-timestamp': oldTimestamp,
    'x-slack-signature': makeSlackSignature(secret, oldTimestamp, body),
  };
  const result = webhook.validate(headers, {}, body);
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('timestamp'));
});

test('SlackWebhook.validate - incorrect signature returns invalid', () => {
  const webhook = new SlackWebhook('my-secret');
  const headers = {
    'x-slack-request-timestamp': freshTimestamp(),
    'x-slack-signature': 'v0=deadbeef',
  };
  const result = webhook.validate(headers, {}, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('signature'));
});

test('SlackWebhook.validate - signature without v0= prefix is rejected', () => {
  const secret = 'my-secret';
  const ts = freshTimestamp();
  const body = 'body';
  const rawSig = createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
  const webhook = new SlackWebhook(secret);
  const headers = {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': rawSig, // no "v0=" prefix
  };
  const result = webhook.validate(headers, {}, body);
  assert.equal(result.valid, false);
});

test('SlackWebhook.validate - signature for wrong secret is rejected', () => {
  const body = 'some body';
  const ts = freshTimestamp();
  const webhook = new SlackWebhook('correct-secret');
  const headers = {
    'x-slack-request-timestamp': ts,
    'x-slack-signature': makeSlackSignature('wrong-secret', ts, body),
  };
  const result = webhook.validate(headers, {}, body);
  assert.equal(result.valid, false);
});

// --- extractMetadata() ---

test('SlackWebhook.extractMetadata - extracts nested event type from event_callback', () => {
  const webhook = new SlackWebhook();
  const meta = webhook.extractMetadata(
    { 'x-slack-request-timestamp': '1234567890' },
    { type: 'event_callback', event: { type: 'message' } }
  );
  assert.equal(meta.eventType, 'message');
  assert.equal(meta.eventId, '1234567890');
});

test('SlackWebhook.extractMetadata - uses top-level type when no nested event', () => {
  const webhook = new SlackWebhook();
  const meta = webhook.extractMetadata({}, { type: 'url_verification' });
  assert.equal(meta.eventType, 'url_verification');
});

test('SlackWebhook.extractMetadata - falls back to "unknown" eventType with no body', () => {
  const webhook = new SlackWebhook();
  const meta = webhook.extractMetadata({}, {});
  assert.equal(meta.eventType, 'unknown');
});

test('SlackWebhook.extractMetadata - parses retry number from header', () => {
  const webhook = new SlackWebhook();
  const meta = webhook.extractMetadata(
    { 'x-slack-request-timestamp': '123', 'x-slack-retry-num': '2' },
    {}
  );
  assert.equal(meta.retryNum, 2);
});

test('SlackWebhook.extractMetadata - retryNum is absent when header is not present', () => {
  const webhook = new SlackWebhook();
  const meta = webhook.extractMetadata({}, {});
  assert.equal(meta.retryNum, undefined);
});
