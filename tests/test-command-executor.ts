import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandExecutor } from '../src/watcher/utils/CommandExecutor.js';
import type {
  Reactor,
  NormalizedEvent,
  CommandExecutorConfig,
} from '../src/watcher/types/index.js';

// --- Fixtures ---

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: 'github:owner/repo:opened:42:abc123def',
    provider: 'github',
    type: 'issue',
    action: 'opened',
    resource: {
      number: 42,
      title: 'Fix the bug',
      description: 'A test issue',
      url: 'https://github.com/owner/repo/issues/42',
      state: 'open',
      repository: 'owner/repo',
    },
    actor: { username: 'user1', id: 1 },
    metadata: { timestamp: '2024-01-01T00:00:00.000Z' },
    raw: {},
    ...overrides,
  };
}

function makeReactor(): { reactor: Reactor; comments: string[] } {
  const comments: string[] = [];
  const reactor: Reactor = {
    getLastComment: async () => null,
    postComment: async (comment: string) => {
      comments.push(comment);
      return 'comment-id';
    },
    isBotAuthor: () => false,
  };
  return { reactor, comments };
}

function baseConfig(overrides: Partial<CommandExecutorConfig> = {}): CommandExecutorConfig {
  return { enabled: true, command: 'true', ...overrides };
}

function tmpTemplate(content: string): string {
  const name = `test-executor-${Date.now()}-${Math.random().toString(36).slice(2)}.hbs`;
  const path = join(tmpdir(), name);
  writeFileSync(path, content);
  return path;
}

// Renders a prompt template via the executor and returns the content received
// by the subprocess as the PROMPT env var (follow-up comment text).
async function renderViaPrompt(template: string, event: NormalizedEvent): Promise<string> {
  const executor = new CommandExecutor(
    baseConfig({
      command: 'echo "$PROMPT"',
      promptTemplate: template,
      useStdin: false,
      followUp: true,
    })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', event, reactor);
  assert.equal(comments.length, 2, 'expected initial comment + follow-up');
  return comments[1]!.trim();
}

// ============================================================
// Constructor
// ============================================================

test('CommandExecutor constructor - skips template loading when enabled=false', () => {
  // A missing template file path must not throw when disabled
  assert.doesNotThrow(() => {
    new CommandExecutor({
      enabled: false,
      command: 'echo hi',
      promptTemplateFile: '/nonexistent/path.hbs',
    });
  });
});

test('CommandExecutor constructor - accepts inline promptTemplate string', () => {
  assert.doesNotThrow(() => {
    new CommandExecutor(baseConfig({ promptTemplate: '{{provider}}' }));
  });
});

test('CommandExecutor constructor - loads promptTemplateFile from disk', () => {
  const path = tmpTemplate('hello {{provider}}');
  assert.doesNotThrow(() => {
    new CommandExecutor(baseConfig({ promptTemplateFile: path }));
  });
});

test('CommandExecutor constructor - loads per-provider template from disk', () => {
  const path = tmpTemplate('github: {{resource.title}}');
  assert.doesNotThrow(() => {
    new CommandExecutor(baseConfig({ prompts: { github: path } }));
  });
});

test('CommandExecutor constructor - throws when promptTemplateFile does not exist', () => {
  assert.throws(() => {
    new CommandExecutor(baseConfig({ promptTemplateFile: '/nonexistent/template.hbs' }));
  });
});

test('CommandExecutor constructor - throws when a prompts entry file does not exist', () => {
  assert.throws(() => {
    new CommandExecutor(baseConfig({ prompts: { github: '/nonexistent/template.hbs' } }));
  });
});

// ============================================================
// execute() — disabled
// ============================================================

test('CommandExecutor execute() - returns immediately when enabled=false', async () => {
  const executor = new CommandExecutor({ enabled: false, command: 'exit 1' });
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent(), reactor);
  assert.equal(comments.length, 0);
});

// ============================================================
// execute() — dry-run
// ============================================================

test('CommandExecutor execute() - dry-run posts initial comment', async () => {
  const executor = new CommandExecutor(baseConfig({ dryRun: true }));
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'issue #42', makeEvent(), reactor);
  assert.equal(comments.length, 1);
  assert.ok(comments[0]!.includes('issue #42'));
});

test('CommandExecutor execute() - dry-run does not execute the command', async () => {
  // command would fail if actually run; dry-run must suppress it
  const executor = new CommandExecutor(baseConfig({ dryRun: true, command: 'exit 1' }));
  const { reactor } = makeReactor();
  await assert.doesNotReject(() => executor.execute('evt-1', 'display', makeEvent(), reactor));
});

test('CommandExecutor execute() - dry-run does not post follow-up even with followUp=true', async () => {
  const executor = new CommandExecutor(
    baseConfig({ dryRun: true, followUp: true, command: 'echo hi' })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent(), reactor);
  assert.equal(comments.length, 1);
});

// ============================================================
// execute() — command success / failure
// ============================================================

test('CommandExecutor execute() - resolves when command exits 0', async () => {
  const executor = new CommandExecutor(baseConfig({ command: 'true' }));
  const { reactor } = makeReactor();
  await assert.doesNotReject(() => executor.execute('evt-1', 'display', makeEvent(), reactor));
});

test('CommandExecutor execute() - resolves (swallows error) when command exits non-zero', async () => {
  const executor = new CommandExecutor(baseConfig({ command: 'exit 1' }));
  const { reactor } = makeReactor();
  // execute() has a top-level catch — must never reject
  await assert.doesNotReject(() => executor.execute('evt-1', 'display', makeEvent(), reactor));
});

// ============================================================
// execute() — environment variables
// ============================================================

test('CommandExecutor execute() - sets EVENT_ID env var', async () => {
  const executor = new CommandExecutor(baseConfig({ command: 'echo "$EVENT_ID"', followUp: true }));
  const { reactor, comments } = makeReactor();
  const event = makeEvent({ id: 'my-unique-event-id' });
  await executor.execute('evt-1', 'display', event, reactor);
  assert.equal(comments[1]!.trim(), 'my-unique-event-id');
});

test('CommandExecutor execute() - EVENT_SAFE_ID replaces special characters with underscores', async () => {
  const executor = new CommandExecutor(
    baseConfig({ command: 'echo "$EVENT_SAFE_ID"', followUp: true })
  );
  const { reactor, comments } = makeReactor();
  const event = makeEvent({ id: 'github:owner/repo:123' });
  await executor.execute('evt-1', 'display', event, reactor);
  assert.equal(comments[1]!.trim(), 'github_owner_repo_123');
});

test('CommandExecutor execute() - EVENT_SHORT_ID matches provider-repo-number-hash format', async () => {
  const executor = new CommandExecutor(
    baseConfig({ command: 'echo "$EVENT_SHORT_ID"', followUp: true })
  );
  const { reactor, comments } = makeReactor();
  const event = makeEvent({
    id: 'github:owner/repo:opened:42:abc123def',
    provider: 'github',
    resource: {
      number: 42,
      title: 'test',
      description: '',
      url: '',
      state: 'open',
      repository: 'owner/repo',
    },
  });
  await executor.execute('evt-1', 'display', event, reactor);
  assert.match(comments[1]!.trim(), /^github-owner-repo-42-[a-z0-9]{6}$/);
});

test('CommandExecutor execute() - sets PROMPT env var when useStdin=false', async () => {
  const executor = new CommandExecutor(
    baseConfig({
      command: 'echo "$PROMPT"',
      promptTemplate: '{{provider}}',
      useStdin: false,
      followUp: true,
    })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent({ provider: 'github' }), reactor);
  assert.equal(comments[1]!.trim(), 'github');
});

test('CommandExecutor execute() - does not set PROMPT env var when useStdin=true', async () => {
  // Temporarily remove PROMPT from the test process so it cannot bleed into the subprocess
  const saved = process.env['PROMPT'];
  delete process.env['PROMPT'];
  try {
    const executor = new CommandExecutor(
      baseConfig({
        command: 'printenv PROMPT || echo "not-set"',
        promptTemplate: '{{provider}}',
        useStdin: true,
        followUp: true,
      })
    );
    const { reactor, comments } = makeReactor();
    await executor.execute('evt-1', 'display', makeEvent(), reactor);
    assert.equal(comments[1]!.trim(), 'not-set');
  } finally {
    if (saved !== undefined) process.env['PROMPT'] = saved;
  }
});

// ============================================================
// execute() — stdin mode
// ============================================================

test('CommandExecutor execute() - writes rendered prompt to stdin when useStdin=true', async () => {
  const executor = new CommandExecutor(
    baseConfig({
      command: 'cat',
      promptTemplate: 'hello {{provider}}',
      useStdin: true,
      followUp: true,
    })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent({ provider: 'testprovider' }), reactor);
  assert.equal(comments[1]!.trim(), 'hello testprovider');
});

// ============================================================
// execute() — template selection
// ============================================================

test('CommandExecutor execute() - uses provider-specific template over default', async () => {
  const specificPath = tmpTemplate('specific: {{provider}}');
  const executor = new CommandExecutor(
    baseConfig({
      command: 'echo "$PROMPT"',
      promptTemplate: 'default: {{provider}}',
      prompts: { github: specificPath },
      useStdin: false,
      followUp: true,
    })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent({ provider: 'github' }), reactor);
  assert.equal(comments[1]!.trim(), 'specific: github');
});

test('CommandExecutor execute() - falls back to default template when provider has no match', async () => {
  const linearPath = tmpTemplate('linear: {{provider}}');
  const executor = new CommandExecutor(
    baseConfig({
      command: 'echo "$PROMPT"',
      promptTemplate: 'default: {{provider}}',
      prompts: { linear: linearPath },
      useStdin: false,
      followUp: true,
    })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent({ provider: 'github' }), reactor);
  assert.equal(comments[1]!.trim(), 'default: github');
});

test('CommandExecutor execute() - renders template loaded from promptTemplateFile', async () => {
  const path = tmpTemplate('file: {{provider}}');
  const executor = new CommandExecutor(
    baseConfig({
      command: 'echo "$PROMPT"',
      promptTemplateFile: path,
      useStdin: false,
      followUp: true,
    })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent({ provider: 'testprovider' }), reactor);
  assert.equal(comments[1]!.trim(), 'file: testprovider');
});

test('CommandExecutor execute() - uses empty prompt when no template configured', async () => {
  const executor = new CommandExecutor(
    baseConfig({ command: 'echo "${PROMPT:-__empty__}"', useStdin: false, followUp: true })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent(), reactor);
  assert.equal(comments[1]!.trim(), '__empty__');
});

// ============================================================
// execute() — follow-up comment
// ============================================================

test('CommandExecutor execute() - posts follow-up comment when followUp=true and command has output', async () => {
  const executor = new CommandExecutor(baseConfig({ command: 'echo "job done"', followUp: true }));
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent(), reactor);
  assert.equal(comments.length, 2);
  assert.ok(comments[1]!.includes('job done'));
});

test('CommandExecutor execute() - does not post follow-up when followUp=false', async () => {
  const executor = new CommandExecutor(baseConfig({ command: 'echo "output"', followUp: false }));
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent(), reactor);
  assert.equal(comments.length, 1);
});

test('CommandExecutor execute() - does not post follow-up when command produces no output', async () => {
  const executor = new CommandExecutor(baseConfig({ command: 'true', followUp: true }));
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent(), reactor);
  assert.equal(comments.length, 1);
});

test('CommandExecutor execute() - applies followUpTemplate with {output} placeholder', async () => {
  const executor = new CommandExecutor(
    baseConfig({
      command: 'echo "session-123"',
      followUp: true,
      followUpTemplate: 'Session started: {output}',
    })
  );
  const { reactor, comments } = makeReactor();
  await executor.execute('evt-1', 'display', makeEvent(), reactor);
  assert.equal(comments[1], 'Session started: session-123');
});

// ============================================================
// Handlebars helpers
// ============================================================

test('Handlebars eq helper - renders block when values are equal', async () => {
  const result = await renderViaPrompt(
    '{{#eq type "issue"}}yes{{else}}no{{/eq}}',
    makeEvent({ type: 'issue' })
  );
  assert.equal(result, 'yes');
});

test('Handlebars eq helper - renders else block when values differ', async () => {
  const result = await renderViaPrompt(
    '{{#eq type "issue"}}yes{{else}}no{{/eq}}',
    makeEvent({ type: 'pull_request' })
  );
  assert.equal(result, 'no');
});

test('Handlebars ne helper - renders block when values are not equal', async () => {
  const result = await renderViaPrompt(
    '{{#ne type "pr"}}yes{{else}}no{{/ne}}',
    makeEvent({ type: 'issue' })
  );
  assert.equal(result, 'yes');
});

test('Handlebars and helper - renders block when both values are truthy', async () => {
  const result = await renderViaPrompt(
    '{{#and type action}}yes{{else}}no{{/and}}',
    makeEvent({ type: 'issue', action: 'opened' })
  );
  assert.equal(result, 'yes');
});

test('Handlebars and helper - renders else block when a value is falsy', async () => {
  const result = await renderViaPrompt(
    '{{#and type action}}yes{{else}}no{{/and}}',
    makeEvent({ type: 'issue', action: '' })
  );
  assert.equal(result, 'no');
});

test('Handlebars or helper - renders block when first value is truthy', async () => {
  const result = await renderViaPrompt(
    '{{#or type ""}}yes{{else}}no{{/or}}',
    makeEvent({ type: 'issue' })
  );
  assert.equal(result, 'yes');
});

test('Handlebars or helper - renders else block when both values are falsy', async () => {
  const result = await renderViaPrompt(
    '{{#or action ""}}yes{{else}}no{{/or}}',
    makeEvent({ action: '' })
  );
  assert.equal(result, 'no');
});
