import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JiraComments } from '../src/watcher/providers/jira/JiraComments.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(id: string) {
  return {
    id,
    author: { accountId: `user-${id}`, displayName: `User ${id}` },
    body: `Comment ${id}`,
    created: new Date().toISOString(),
  };
}

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function mockFetch(pages: FetchResponse[]): () => void {
  let call = 0;
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    const page = pages[call++] ?? pages[pages.length - 1];
    return {
      ok: page.ok,
      status: page.status ?? 200,
      statusText: page.ok ? 'OK' : 'Error',
      headers: { get: () => null },
      json: page.json ?? (() => Promise.resolve({})),
      text: page.text ?? (() => Promise.resolve('')),
    };
  };
  return () => {
    (globalThis as any).fetch = original;
  };
}

const comments = new JiraComments('https://test.atlassian.net', 'Bearer token');

// ---------------------------------------------------------------------------
// JiraComments.getComments - pagination
// ---------------------------------------------------------------------------

test('JiraComments.getComments - single page: returns all comments', async () => {
  const page1 = [makeComment('1'), makeComment('2'), makeComment('3')];
  const restore = mockFetch([
    {
      ok: true,
      json: () => Promise.resolve({ comments: page1, total: 3 }),
    },
  ]);
  try {
    const result = await comments.getComments('PROJ-1');
    assert.equal(result.length, 3);
    assert.equal(result[2]!.id, '3');
  } finally {
    restore();
  }
});

test('JiraComments.getComments - multi-page: fetches all pages and returns combined results', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => makeComment(String(i + 1)));
  const page2 = [makeComment('101'), makeComment('102')];
  const restore = mockFetch([
    { ok: true, json: () => Promise.resolve({ comments: page1, total: 102 }) },
    { ok: true, json: () => Promise.resolve({ comments: page2, total: 102 }) },
  ]);
  try {
    const result = await comments.getComments('PROJ-1');
    assert.equal(result.length, 102);
    assert.equal(result[101]!.id, '102');
  } finally {
    restore();
  }
});

test('JiraComments.getComments - stops when page smaller than pageSize even if total unknown', async () => {
  const page1 = [makeComment('1'), makeComment('2')];
  const restore = mockFetch([
    {
      ok: true,
      // total absent — rely on page.length < pageSize to stop
      json: () => Promise.resolve({ comments: page1 }),
    },
  ]);
  try {
    const result = await comments.getComments('PROJ-1');
    assert.equal(result.length, 2);
  } finally {
    restore();
  }
});

test('JiraComments.getComments - throws on non-ok response', async () => {
  const restore = mockFetch([
    {
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    },
  ]);
  try {
    await assert.rejects(
      () => comments.getComments('PROJ-1'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('403'));
        return true;
      }
    );
  } finally {
    restore();
  }
});
