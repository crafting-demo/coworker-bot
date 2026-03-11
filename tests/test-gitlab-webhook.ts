import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitLabWebhook } from '../src/watcher/providers/gitlab/GitLabWebhook.js';

function baseHeaders(): Record<string, string> {
  return { 'x-gitlab-event': 'Issue Hook' };
}

// --- validate() ---

test('GitLabWebhook.validate - missing X-Gitlab-Event returns invalid', () => {
  const webhook = new GitLabWebhook();
  const result = webhook.validate({}, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('X-Gitlab-Event'));
});

test('GitLabWebhook.validate - valid when no token is configured', () => {
  const webhook = new GitLabWebhook();
  const result = webhook.validate(baseHeaders(), 'body');
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('GitLabWebhook.validate - valid with correct token', () => {
  const webhook = new GitLabWebhook('my-secret-token');
  const headers = { ...baseHeaders(), 'x-gitlab-token': 'my-secret-token' };
  const result = webhook.validate(headers, 'body');
  assert.equal(result.valid, true);
});

test('GitLabWebhook.validate - missing token header when secret is configured returns invalid', () => {
  const webhook = new GitLabWebhook('my-secret-token');
  const result = webhook.validate(baseHeaders(), 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('X-Gitlab-Token'));
});

test('GitLabWebhook.validate - wrong token value returns invalid', () => {
  const webhook = new GitLabWebhook('correct-token');
  const headers = { ...baseHeaders(), 'x-gitlab-token': 'wrong-token' };
  const result = webhook.validate(headers, 'body');
  assert.equal(result.valid, false);
  assert.ok(result.error?.toLowerCase().includes('token'));
});

test('GitLabWebhook.validate - accepts array-valued headers (uses first value)', () => {
  const webhook = new GitLabWebhook();
  const result = webhook.validate({ 'x-gitlab-event': ['Issue Hook', 'Push Hook'] }, 'body');
  assert.equal(result.valid, true);
});

test('GitLabWebhook.validate - token comparison is exact (no partial match)', () => {
  const webhook = new GitLabWebhook('secret');
  const headers = { ...baseHeaders(), 'x-gitlab-token': 'secret-extra' };
  const result = webhook.validate(headers, 'body');
  assert.equal(result.valid, false);
});

// --- extractMetadata() ---

test('GitLabWebhook.extractMetadata - returns event type from header', () => {
  const webhook = new GitLabWebhook();
  const meta = webhook.extractMetadata({ 'x-gitlab-event': 'Merge Request Hook' });
  assert.equal(meta.event, 'Merge Request Hook');
});

test('GitLabWebhook.extractMetadata - throws when event header is missing', () => {
  const webhook = new GitLabWebhook();
  assert.throws(() => webhook.extractMetadata({}), /Missing required/);
});
