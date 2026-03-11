# Tests

This directory contains unit tests for the watcher subsystem.

## Running Tests

```bash
npm test
```

Tests use Node's built-in `node:test` runner with `tsx` for TypeScript transpilation — no additional dependencies required.

## Architecture

Tests follow the architecture described below.

### Reactor Pattern

Providers create `Reactor` instances that encapsulate commenting operations for a specific resource (issue, PR, thread). Each reactor implements:

- `getLastComment()` — fetch the most recent comment for deduplication
- `postComment(body)` — post a new comment/message
- `isBotAuthor(author)` — check if a username belongs to the configured bot

### Provider Differences

| Provider | Auth method  | Signature format                 | Comment ID type       |
| -------- | ------------ | -------------------------------- | --------------------- |
| GitHub   | HMAC SHA-256 | `sha256=<hex>`                   | `""` (not returned)   |
| GitLab   | Shared token | Plain string equality            | Numeric (stringified) |
| Linear   | HMAC SHA-256 | Raw `<hex>` (no prefix)          | String UUID           |
| Slack    | HMAC SHA-256 | `v0=<hex>` over `v0:<ts>:<body>` | `<channel>:<ts>`      |

### Event Handlers

Event handlers receive `(event: NormalizedEvent, reactor: Reactor)` — providers normalize their raw payloads into the shared `NormalizedEvent` structure before calling the handler.

## Adding New Tests

1. Place test files in this directory named `test-*.ts`
2. Use relative imports with `.js` extensions: `import { Foo } from '../src/watcher/...Foo.js'`
3. Use `node:test` and `node:assert/strict` — no external test framework needed
4. Mock external dependencies (HTTP clients, API classes) inline using `Partial<InstanceType<typeof SomeClass>>`
5. Run with `npm test`
