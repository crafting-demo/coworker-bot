# coworker-bot

Automated coding assistant that monitors GitHub, Linear, and Slack for events, then dispatches AI coding agents via Crafting Sandbox to handle them.

## Quick Start

**First time?** Run `/setup` for a guided wizard that walks you through the entire setup process — provider credentials, sandbox creation, and watcher configuration.

## Project Layout

- `src/` — TypeScript source (watcher, providers, transport, utils)
- `config/` — Runtime configuration (`watcher.yaml`) and prompt templates (`.hbs`)
- `templates/` — Crafting Sandbox YAML templates for different provider combinations
- `docs/` — Architecture overview, component docs, setup guides, and example flows
- `tests/` — Test files

## Key Files

- `config/watcher.yaml` — Main runtime config (providers, auth, repos, polling, executor)
- `config/watcher.full.yaml` — Full reference config with all options documented
- `templates/coworker-bot-full.yaml` — Full sandbox template (GitHub + Linear + Slack)
- `docs/examples/templates/coworker-bot-quick-start.yaml` — GitHub-only sandbox template (start here)
- `docs/examples/templates/coworker-bot-slack-2-github-pr.example.yaml` — Slack + GitHub template
- `config/event-prompt.hbs` — Handlebars prompt template for code platform events

## Development

```bash
pnpm start         # Run with tsx (hot reload)
pnpm run build     # Compile TypeScript
pnpm test          # Run tests
pnpm run type-check  # Type check without emitting
```

## Architecture

Events flow: Provider (webhook/poll) → Normalize → Deduplicate → Render prompt → Execute command (`cs llm session run`) → Post follow-up comment. See `docs/overview.md` for details.
