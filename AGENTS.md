# coworker-bot

Automated coding assistant that monitors GitHub, GitLab, Linear, and Slack for events, then dispatches AI coding agents via Crafting Sandbox to handle them.

## Before You Start

- `config/watcher.yaml` does not exist in the repo — it is injected at sandbox start. Read `config/watcher.full.yaml` for the reference config. Never commit `watcher.yaml`.
- `_local/` does not exist in the repo — it is gitignored and used for local sandbox template customizations.

## Before Creating a PR

```bash
pnpm run type-check   # type check without emitting
pnpm test             # run all tests
pnpm run lint:fix     # auto-fix lint errors
pnpm run format       # auto-format code
```

## Conventions

- **ESM imports require `.js` extensions** even when importing `.ts` files — omitting them breaks at runtime
- **`validateWebhook` must return `false` for invalid signatures, never throw** — throwing causes a 500; returning `false` causes a 401
- **Single-event failures must not crash the process** — wrap per-event logic in try/catch and continue; see `Watcher.createEventHandler()` for the pattern
- **Use typed error classes** from `src/watcher/utils/errors.ts`: `ProviderError`, `ConfigError`, `WatcherError`
- **Never log token or secret values**, even at `debug` level

## Architecture Notes

- **Env vars always win over `watcher.yaml`** — config is file-first then env overlay; the file is optional and the system must work without it
- **Deduplication is comment-order sensitive** — the bot skips an event if it was the last to comment; changes to comment posting order or timing can suppress or re-trigger events
- **Polling and webhooks run concurrently** — `poll()` and `handleWebhook()` may be called simultaneously; providers must have no shared mutable state between calls

## Provider Structure

Each provider follows the same six-file split under `src/watcher/providers/<name>/`:

- `*Provider.ts` — implements `IProvider`, wires the other classes together
- `*Normalizer.ts` — converts raw payload → `NormalizedEvent`
- `*Webhook.ts` — validates and parses incoming webhook requests
- `*Reactor.ts` — implements `Reactor` (comment read/write for deduplication)
- `*Poller.ts` — queries platform API for recent events
- `*Comments.ts` — low-level comment API calls

When adding a new provider, also register it in `src/watcher/index.ts`, add env var handling in `ConfigLoader.buildFromEnv()`, and document the vars in `config/watcher.full.yaml`.
