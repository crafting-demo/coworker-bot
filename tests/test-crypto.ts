import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { computeHmacSignature, verifyHmacSignature } from '../src/watcher/utils/crypto.js';

test('computeHmacSignature - produces correct sha256 HMAC for string payload', () => {
  const secret = 'test-secret';
  const payload = 'hello world';
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(computeHmacSignature(payload, secret), expected);
});

test('computeHmacSignature - works with Buffer payload', () => {
  const secret = 'test-secret';
  const payload = Buffer.from('binary data');
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(computeHmacSignature(payload, secret), expected);
});

test('computeHmacSignature - uses the specified algorithm', () => {
  const secret = 'test-secret';
  const payload = 'data';
  const expected = createHmac('sha1', secret).update(payload).digest('hex');
  assert.equal(computeHmacSignature(payload, secret, 'sha1'), expected);
});

test('verifyHmacSignature - returns true for a valid signature', () => {
  const secret = 'test-secret';
  const payload = 'test payload';
  const signature = computeHmacSignature(payload, secret);
  assert.equal(verifyHmacSignature(payload, signature, secret), true);
});

test('verifyHmacSignature - returns false for a wrong signature', () => {
  assert.equal(verifyHmacSignature('payload', 'wrong-sig', 'secret'), false);
});

test('verifyHmacSignature - returns false when secret differs', () => {
  const payload = 'test payload';
  const signature = computeHmacSignature(payload, 'secret1');
  assert.equal(verifyHmacSignature(payload, signature, 'secret2'), false);
});

test('verifyHmacSignature - returns false for tampered payload', () => {
  const secret = 'test-secret';
  const signature = computeHmacSignature('original payload', secret);
  assert.equal(verifyHmacSignature('tampered payload', signature, secret), false);
});

test('verifyHmacSignature - works with a prefix', () => {
  const secret = 'test-secret';
  const payload = 'test payload';
  const rawSig = computeHmacSignature(payload, secret);
  const sigWithPrefix = `sha256=${rawSig}`;
  assert.equal(verifyHmacSignature(payload, sigWithPrefix, secret, 'sha256', 'sha256='), true);
});

test('verifyHmacSignature - returns false for different-length signature', () => {
  assert.equal(verifyHmacSignature('payload', 'short', 'secret'), false);
});
