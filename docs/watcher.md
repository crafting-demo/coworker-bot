# Watcher: Event Listener & Orchestrator

> Part of the [coworker-bot overview](./overview.md). This doc covers the design and features of the Watcher component specifically.

Watcher is a Node.js service that listens for events from developer platforms, filters them, and triggers the downstream coding agent. It is purely an orchestrator — it does not write code itself.

---

## Event Ingestion

Two modes run concurrently and feed the same pipeline:

**Webhooks** — an Express HTTP server receives real-time push events from platforms. Each provider registers its own endpoint at `/webhook/{provider}`. Every incoming request is signature-verified before processing.

**Polling** — a per-provider poller calls the platform API on a configurable interval (e.g. every 60s) to catch events that may have been missed. Polling is optional and only activates when `pollingInterval` and auth credentials are configured. For Slack, polling also requires `pollingEnabled: true` in the provider options.

The poller skips a cycle if the previous poll is still running, and stops itself after 5 consecutive failures (with exponential backoff between retries, capped at 60s).

---

## Provider System

Each platform (GitHub, Linear, Slack) is implemented as a provider. All providers share the same interface:

- `initialize(config)` — validate config and authenticate
- `validateWebhook(headers, body, rawBody)` — verify request signature
- `handleWebhook(headers, body, eventHandler)` — parse and normalize the payload
- `poll(eventHandler)` — query the API for recent events
- `shutdown()` — clean up

**Normalization** is the key design point. Every provider maps its platform-specific payload into a common `NormalizedEvent` shape before handing it off. This means the rest of the pipeline — deduplication, prompt rendering, command execution — is completely provider-agnostic.

```
NormalizedEvent {
  id, provider, type, action,
  resource: { number, title, description, url, state, repository,
               author?, assignees?, labels?, branch?, mergeTo?, comment? },
  actor: { username, id },
  metadata: { timestamp, deliveryId?, polled? },
  raw
}
```

---

## Event Filtering

Each provider has built-in default filters (e.g. GitHub skips most PR lifecycle events by default). These can be overridden per-provider in config using `eventFilter`, which supports allowlists (`actions`) and denylists (`skipActions`/`skipStates`).

---

## Deduplication

To prevent triggering the agent twice on the same issue or PR, Watcher uses a **last-comment strategy**:

1. After receiving an event, fetch the last comment on that issue/PR/thread
2. If the last comment was posted by the configured bot username (case-insensitive) — skip
3. Otherwise — proceed

This works because Watcher always posts a comment when it starts processing. If that comment is still the last one, no new human activity has occurred since the last run. If a human has commented since, it means there's new work to do.

Errors fetching comments are treated as "not a duplicate" to avoid silently dropping events.

---

## Prompt Construction

Prompts are rendered using [Handlebars](https://handlebarsjs.com/) templates (`.hbs` files). The full `NormalizedEvent` object is passed as context, so templates have access to all event fields.

Template selection order:

1. Provider-specific template (if configured under `prompts.{provider}`)
2. Default `promptTemplateFile`
3. Inline `promptTemplate` string

### Template Format

Templates are standard [Handlebars](https://handlebarsjs.com/) files. Key syntax:

| Syntax                                  | Description                                                     |
| --------------------------------------- | --------------------------------------------------------------- |
| `{{variable}}`                          | Interpolate a value (e.g. `{{provider}}`, `{{resource.title}}`) |
| `{{#if variable}}...{{/if}}`            | Conditional block — renders when `variable` is truthy           |
| `{{#if variable}}...{{else}}...{{/if}}` | If/else block                                                   |
| `{{#each array}}{{this}}{{/each}}`      | Iterate over an array                                           |
| `{{!-- comment --}}`                    | Template comment (not included in output)                       |

**Built-in custom helpers:**

| Helper                       | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| `{{#eq a b}}...{{/eq}}`      | Renders block if `a === b`                                          |
| `{{#ne a b}}...{{/ne}}`      | Renders block if `a !== b`                                          |
| `{{#and a b}}...{{/and}}`    | Renders block if both `a` and `b` are truthy                        |
| `{{#or a b}}...{{/or}}`      | Renders block if either `a` or `b` is truthy                        |
| `{{resourceLink}}`           | Formatted link to the issue/PR (`resource.url` + `resource.number`) |
| `{{commentLink}}`            | Formatted link to the comment (`resource.comment.url`)              |
| `{{link text url provider}}` | Renders a formatted hyperlink for the given provider                |

### NormalizedEvent — Field Reference

The full variable reference (with per-provider notes) is documented at the top of each example template:

- [`config/event-prompt.hbs`](../config/event-prompt.hbs) — GitHub, Linear
- [`config/event-prompt-slack.hbs`](../config/event-prompt-slack.hbs) — Slack

The normalization itself happens in each provider's `normalizeEvent` / `normalizePolledEvent` private methods:

| Provider | File                                             |
| -------- | ------------------------------------------------ |
| GitHub   | `src/watcher/providers/github/GitHubProvider.ts` |
| Linear   | `src/watcher/providers/linear/LinearProvider.ts` |
| Slack    | `src/watcher/providers/slack/SlackProvider.ts`   |

A few provider-specific quirks worth knowing when writing templates:

- **`resource.repository`** — GitHub: `"owner/repo"` · Linear: team key (e.g. `"ENG"`) · Slack: channel ID (e.g. `"C01ABC123"`)
- **`resource.author`** — GitHub: login username · Linear: display name · Slack: user ID
- **`resource.branch` / `resource.mergeTo`** — only set for GitHub PRs; absent for Linear and Slack
- **`resource.comment`** — present when triggered by a comment (GitHub/Linear) or always present for Slack (contains the message itself)
- **`resource.url`** — empty for Slack webhook events; populated for Slack polled mentions
- **`metadata.deliveryId`** — GitHub webhooks only
- **`metadata.channel` / `metadata.threadTs`** — Slack only
- **`metadata.channelType`** — Slack webhooks only (absent for polled events)

---

## Command Execution

Once a prompt is rendered, Watcher:

1. Posts an `"Agent is working on ..."` comment containing a formatted link to the resource (serves as dedup marker)
2. Spawns the configured shell command via `/bin/bash -c`

The command receives:

| Variable         | Description                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `EVENT_SHORT_ID` | Clean, unique ID for naming sessions (e.g. `github-owner-repo-123-a1b2c3`) |
| `EVENT_ID`       | Full event identifier                                                      |
| `EVENT_SAFE_ID`  | Shell-safe version of `EVENT_ID` (special chars → `_`)                     |
| `PROMPT`         | Rendered prompt (if `useStdin: false`)                                     |

If `useStdin: true`, the prompt is piped to the command's stdin instead of `$PROMPT`.

If `followUp: true`, the command's stdout is posted as a follow-up comment on the original issue/PR.

A `dryRun` mode logs what would be executed without spawning anything (but still posts the dedup comment).

---

## Configuration

All behavior is controlled by a single YAML file. Key sections:

```yaml
server:
  host: 0.0.0.0 # optional, defaults to 0.0.0.0
  port: 3000
  basePath: / # optional URL prefix for all webhook endpoints

logLevel: info # optional: debug | info | warn | error

deduplication:
  enabled: true
  commentTemplate: 'Agent is working on {id}'

commandExecutor:
  enabled: true
  command: 'cs llm session run --name=$EVENT_SHORT_ID --task'
  promptTemplateFile: ./config/event-prompt.hbs
  useStdin: false
  followUp: false

providers:
  github:
    enabled: true
    pollingInterval: 60
    auth:
      tokenEnv: GITHUB_TOKEN
    options:
      webhookSecretEnv: GITHUB_WEBHOOK_SECRET
      botUsername: my-bot
      repositories:
        - owner/repo
```

Secrets are never stored in plain text — they reference environment variables (`tokenEnv`, `webhookSecretEnv`) or files (`tokenFile`, `webhookSecretFile`).
