# Configuration Reference

coworker-bot uses a two-layer configuration system. Environment variables are the default approach and work without any file. `watcher.yaml` provides the full option set for advanced setups. When both are present, **env vars always win**.

---

## Layer 1 — Environment Variables

Set env vars in the sandbox template's `env:` block. The watcher reads them at startup and auto-configures each provider when its primary token is present. No `watcher.yaml` is needed for most setups.

### GitHub

| Variable                       | Required             | Description                                                                                     |
| ------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Yes — enables GitHub | Fine-grained PAT for the bot account                                                            |
| `GITHUB_BOT_USERNAME`          | Recommended          | Bot account username used for deduplication; events where the bot's comment is last are skipped |
| `GITHUB_REPOSITORIES`          | Polling only         | Comma-separated repos to poll: `owner/repo1,owner/repo2`                                        |
| `GITHUB_WEBHOOK_SECRET`        | Recommended          | Shared secret used to verify webhook signatures                                                 |
| `GITHUB_POLLING_INTERVAL`      | Optional             | Polling interval in seconds (default: `60`)                                                     |

### Linear

| Variable                  | Required             | Description                                                                  |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `LINEAR_API_TOKEN`        | Yes — enables Linear | API key from Linear settings                                                 |
| `LINEAR_BOT_USERNAME`     | Recommended          | Linear display name of the bot user; used for deduplication                  |
| `LINEAR_TEAMS`            | Optional             | Comma-separated team keys to monitor, e.g. `ENG,DESIGN` (default: all teams) |
| `LINEAR_WEBHOOK_SECRET`   | Recommended          | Shared secret used to verify webhook signatures                              |
| `LINEAR_POLLING_INTERVAL` | Optional             | Polling interval in seconds (default: `60`)                                  |

### Slack

| Variable               | Required            | Description                                          |
| ---------------------- | ------------------- | ---------------------------------------------------- |
| `SLACK_BOT_TOKEN`      | Yes — enables Slack | Bot User OAuth Token (`xoxb-...`) from the Slack app |
| `SLACK_SIGNING_SECRET` | Recommended         | Signing secret used to verify webhook requests       |

### General

| Variable            | Description                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `WATCHER_COMMAND`   | Override the command executed per event (default: `cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task`) |
| `WATCHER_LOG_LEVEL` | Log verbosity: `debug` \| `info` \| `warn` \| `error` (default: `info`)                                               |

---

## Layer 2 — watcher.yaml

`watcher.yaml` exposes the full option set, including event filters, polling tuning, per-provider options, and prompt configuration. It is optional — env vars alone are sufficient for most setups.

The file is loaded from `config/watcher.yaml` by default. In the sandbox template it is injected via the `system.files` block so it is never edited inside the sandbox directly.

**Env vars always override** the corresponding fields in the file. The merge rules are:

- `WATCHER_COMMAND` overrides `commandExecutor.command`
- `WATCHER_LOG_LEVEL` overrides `logLevel`
- Per-provider env vars (token, bot username, repos, etc.) override the matching fields under `providers.<name>`
- Fields present only in the file are kept as-is

### Top-level structure

```yaml
server:
  host: 0.0.0.0
  port: 3000
  basePath: / # optional URL prefix for all webhook paths

logLevel: info # debug | info | warn | error

deduplication:
  enabled: true
  commentTemplate: 'Agent is working on {id}' # {id} = e.g. "owner/repo#123"

commandExecutor:
  enabled: true
  command: 'cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task'
  promptTemplateFile: ./config/event-prompt.hbs
  useStdin: true # true = prompt via stdin; false = via $PROMPT env var
  followUp: true # post command stdout as a follow-up comment
  dryRun: false # log command without executing (useful for testing)
  followUpTemplate: 'Session started: {output}' # optional; raw output used if absent

providers:
  github:
    enabled: true
    pollingInterval: 60
    auth:
      type: token
      tokenEnv: GITHUB_PERSONAL_ACCESS_TOKEN
    options:
      webhookSecretEnv: GITHUB_WEBHOOK_SECRET
      botUsername: my-bot
      repositories:
        - owner/repo1
      eventFilter:
        issues: {}
        issue_comment: {}
```

See `config/watcher.full.yaml` for the full reference, including all providers and every available option.

### Event filtering

Each provider supports an `eventFilter` block that controls which event types and actions trigger the agent. If omitted, built-in defaults apply.

```yaml
# Only respond to issue and comment events; ignore PRs entirely
options:
  eventFilter:
    issues: {}
    issue_comment: {}

# Respond to PRs only when closed or review-requested; skip everything else
options:
  eventFilter:
    pull_request:
      actions: ['closed', 'review_requested']
```

Provider defaults:

| Provider | Default behaviour                                                                         |
| -------- | ----------------------------------------------------------------------------------------- |
| GitHub   | Issues and comments processed; most PR lifecycle events (open, sync, label, etc.) skipped |
| Linear   | Issue events only; done/cancelled states skipped                                          |
| Slack    | `app_mention` events only                                                                 |

---

## Defaults (no watcher.yaml)

When no `watcher.yaml` is present, the watcher uses these built-in defaults and then overlays any env vars on top:

```yaml
server:
  host: 0.0.0.0
  port: 3000
deduplication:
  enabled: true
  commentTemplate: 'Agent is working on {id}'
commandExecutor:
  enabled: true
  command: 'cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task'
  promptTemplateFile: ./config/event-prompt.hbs
  useStdin: true
  followUp: true
```

---

## Which approach to use

| Need                                       | Use                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Get started quickly                        | Env vars only — set token, bot username, repos in the template                              |
| Override the agent command                 | `WATCHER_COMMAND` env var                                                                   |
| Filter specific event types or actions     | `watcher.yaml` — `providers.<name>.options.eventFilter`                                     |
| Tune polling intervals or lookback windows | `watcher.yaml` — `pollingInterval`, `initialLookbackHours`                                  |
| Per-provider prompt templates              | `watcher.yaml` — `commandExecutor.prompts` — see [prompt-templates.md](prompt-templates.md) |
| Dry-run / debug mode                       | `watcher.yaml` — `commandExecutor.dryRun: true`                                             |

---

## YAML env var interpolation

Inside `watcher.yaml`, you can reference environment variables using `${VAR_NAME}` syntax. This is resolved at load time:

```yaml
providers:
  github:
    auth:
      token: ${GITHUB_PERSONAL_ACCESS_TOKEN}
```

If the variable is not set, the placeholder is left as-is and a warning is logged. In practice, use `tokenEnv`/`webhookSecretEnv` instead of `token`/`webhookSecret` — the `*Env` fields defer resolution until the value is actually needed and produce clearer error messages when a variable is missing.
