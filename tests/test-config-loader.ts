import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigLoader } from '../src/watcher/core/ConfigLoader.js';
import { ConfigError } from '../src/watcher/utils/errors.js';

const tempDir = join(tmpdir(), `coworker-bot-config-tests-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
after(() => rmSync(tempDir, { recursive: true, force: true }));

function writeYaml(name: string, content: string): string {
  const filePath = join(tempDir, name);
  writeFileSync(filePath, content);
  return filePath;
}

// --- ConfigLoader.load() ---

test('ConfigLoader.load - loads a valid config file', () => {
  const path = writeYaml('valid.yaml', 'providers:\n  github:\n    enabled: true\n');
  const config = ConfigLoader.load(path);
  assert.ok(config.providers['github']?.enabled === true);
});

test('ConfigLoader.load - throws ConfigError for a non-existent file', () => {
  assert.throws(
    () => ConfigLoader.load('/nonexistent/path.yaml'),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      return true;
    }
  );
});

test('ConfigLoader.load - throws ConfigError when "providers" key is absent', () => {
  const path = writeYaml('no-providers.yaml', 'server:\n  port: 3000\n');
  assert.throws(
    () => ConfigLoader.load(path),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.ok(err.message.includes('providers'));
      return true;
    }
  );
});

test('ConfigLoader.load - throws ConfigError when providers object is empty', () => {
  const path = writeYaml('empty-providers.yaml', 'providers: {}\n');
  assert.throws(
    () => ConfigLoader.load(path),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      return true;
    }
  );
});

test('ConfigLoader.load - interpolates ${ENV_VAR} placeholders', () => {
  process.env['TEST_CFG_TOKEN'] = 'secret-from-env';
  const path = writeYaml(
    'env-var.yaml',
    [
      'providers:',
      '  github:',
      '    enabled: true',
      '    auth:',
      '      type: token',
      '      token: ${TEST_CFG_TOKEN}',
    ].join('\n')
  );
  const config = ConfigLoader.load(path);
  assert.equal(config.providers['github']?.auth?.token, 'secret-from-env');
  delete process.env['TEST_CFG_TOKEN'];
});

test('ConfigLoader.load - keeps placeholder when env var is not defined', () => {
  delete process.env['UNDEF_VAR_99999'];
  const path = writeYaml(
    'undef-env.yaml',
    [
      'providers:',
      '  github:',
      '    enabled: true',
      '    auth:',
      '      type: token',
      '      token: ${UNDEF_VAR_99999}',
    ].join('\n')
  );
  const config = ConfigLoader.load(path);
  assert.equal(config.providers['github']?.auth?.token, '${UNDEF_VAR_99999}');
});

test('ConfigLoader.load - succeeds for an enabled provider without auth (just warns)', () => {
  const path = writeYaml('no-auth.yaml', 'providers:\n  github:\n    enabled: true\n');
  // Should not throw; missing auth is a warning, not an error
  const config = ConfigLoader.load(path);
  assert.equal(config.providers['github']?.auth, undefined);
});

// --- ConfigLoader.resolveSecret() ---

test('ConfigLoader.resolveSecret - returns a direct value as-is', () => {
  assert.equal(ConfigLoader.resolveSecret('direct'), 'direct');
});

test('ConfigLoader.resolveSecret - returns undefined when nothing is provided', () => {
  assert.equal(ConfigLoader.resolveSecret(), undefined);
});

test('ConfigLoader.resolveSecret - reads value from an environment variable', () => {
  process.env['TEST_SECRET_VAR'] = 'env-value';
  assert.equal(ConfigLoader.resolveSecret(undefined, 'TEST_SECRET_VAR'), 'env-value');
  delete process.env['TEST_SECRET_VAR'];
});

test('ConfigLoader.resolveSecret - throws ConfigError when env var is not set', () => {
  delete process.env['MISSING_SECRET_VAR'];
  assert.throws(
    () => ConfigLoader.resolveSecret(undefined, 'MISSING_SECRET_VAR'),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.ok(err.message.includes('MISSING_SECRET_VAR'));
      return true;
    }
  );
});

test('ConfigLoader.resolveSecret - reads and trims content from a file', () => {
  const secretFile = join(tempDir, 'secret.txt');
  writeFileSync(secretFile, '  file-secret-value  \n');
  assert.equal(ConfigLoader.resolveSecret(undefined, undefined, secretFile), 'file-secret-value');
});

test('ConfigLoader.resolveSecret - throws ConfigError for a missing secret file', () => {
  assert.throws(
    () => ConfigLoader.resolveSecret(undefined, undefined, '/nonexistent/secret.txt'),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      return true;
    }
  );
});

test('ConfigLoader.resolveSecret - direct value takes precedence over envVar', () => {
  process.env['SOME_ENV'] = 'env-value';
  assert.equal(ConfigLoader.resolveSecret('direct', 'SOME_ENV'), 'direct');
  delete process.env['SOME_ENV'];
});
