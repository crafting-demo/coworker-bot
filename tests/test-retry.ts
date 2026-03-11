import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withExponentialRetry } from '../src/watcher/utils/retry.js';

test('withExponentialRetry - succeeds on first try', async () => {
  let callCount = 0;
  const result = await withExponentialRetry(async () => {
    callCount++;
    return 'success';
  });
  assert.equal(result, 'success');
  assert.equal(callCount, 1);
});

test('withExponentialRetry - retries on 409 status object and eventually succeeds', async () => {
  let callCount = 0;
  const result = await withExponentialRetry(
    async () => {
      callCount++;
      if (callCount < 3) throw { status: 409 };
      return 'eventual success';
    },
    { baseDelayMs: 1, maxRetries: 5 }
  );
  assert.equal(result, 'eventual success');
  assert.equal(callCount, 3);
});

test('withExponentialRetry - retries on Response-like object with 409', async () => {
  let callCount = 0;
  const result = await withExponentialRetry(
    async () => {
      callCount++;
      if (callCount < 2) throw { status: 409 } as unknown as Response;
      return 42;
    },
    { baseDelayMs: 1, maxRetries: 3 }
  );
  assert.equal(result, 42);
  assert.equal(callCount, 2);
});

test('withExponentialRetry - throws non-retryable errors immediately without retrying', async () => {
  let callCount = 0;
  await assert.rejects(
    async () => {
      await withExponentialRetry(async () => {
        callCount++;
        throw new Error('fatal error');
      });
    },
    { message: 'fatal error' }
  );
  assert.equal(callCount, 1);
});

test('withExponentialRetry - throws after exhausting maxRetries', async () => {
  let callCount = 0;
  await assert.rejects(async () => {
    await withExponentialRetry(
      async () => {
        callCount++;
        throw { status: 409 };
      },
      { maxRetries: 2, baseDelayMs: 1 }
    );
  });
  assert.equal(callCount, 3); // 1 initial + 2 retries
});

test('withExponentialRetry - honours custom shouldRetry predicate', async () => {
  let callCount = 0;
  const result = await withExponentialRetry(
    async () => {
      callCount++;
      if (callCount < 2) throw new Error('custom retryable');
      return 'done';
    },
    {
      baseDelayMs: 1,
      maxRetries: 3,
      shouldRetry: (err) => err instanceof Error && err.message === 'custom retryable',
    }
  );
  assert.equal(result, 'done');
  assert.equal(callCount, 2);
});
