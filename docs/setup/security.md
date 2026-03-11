# Security Hardening

This guide covers the security controls that should be applied to every coworker-bot deployment. The individual provider setup guides cover the mechanics of each step; this doc explains the _why_ and collects all controls in one place.

---

## Sandbox Secrets — Admin Only + Not Mountable

Every secret you create for coworker-bot must be marked with two flags in the Crafting Web Console:

**Web Console → Secrets → select secret → Edit → check both:**

- **Admin Only** — the secret is only accessible when the sandbox runs in Restriction Mode. This prevents a compromised agent session from reading its own credentials by inspecting the process environment.
- **Not Mountable** — the secret is never written to the filesystem. It is only available as an environment variable. This prevents the agent from reading credentials off disk even if it can list files.

Apply these flags to every secret:

| Secret                  | Provider |
| ----------------------- | -------- |
| `github-pat`            | GitHub   |
| `github-webhook-secret` | GitHub   |
| `linear-pat`            | Linear   |
| `linear-webhook-secret` | Linear   |
| `slack-bot-token`       | Slack    |
| `slack-signing-secret`  | Slack    |

**Without these flags**, a sufficiently capable agent session could read its own API tokens from the environment and use them outside the sandbox.

---

## Webhook Signature Verification

Every provider should be configured with a webhook secret so the watcher can verify that incoming requests genuinely come from that provider. Requests that fail verification are rejected before any event processing happens.

| Provider | Secret env var          | How the secret is used                                        |
| -------- | ----------------------- | ------------------------------------------------------------- |
| GitHub   | `GITHUB_WEBHOOK_SECRET` | HMAC-SHA256 signature in `X-Hub-Signature-256` header         |
| Linear   | `LINEAR_WEBHOOK_SECRET` | HMAC-SHA256 signature in `Linear-Signature` header            |
| Slack    | `SLACK_SIGNING_SECRET`  | HMAC-SHA256 of timestamp + body in `X-Slack-Signature` header |

Generate each webhook secret with:

```bash
openssl rand -hex 32
```

Use a different random value for each provider. Configure the same value in both the provider's webhook settings and the corresponding Crafting secret.

**Without a webhook secret**, anyone who discovers your sandbox's webhook URL can inject arbitrary events and trigger agent sessions.

---

## Dedicated Bot Accounts

Each provider should have a dedicated service account used exclusively by coworker-bot. Do not use personal accounts.

**Why this matters:**

- The watcher skips events where the bot's comment is the most recent one (deduplication). Using a personal account suppresses your own activity.
- A dedicated account makes audit logs clear: every action taken by the agent is attributed to a clearly named bot account.
- Revoking access is scoped — you can revoke the bot account's token without affecting your personal access.

| Provider | Guidance                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------- |
| GitHub   | Create a separate GitHub account (e.g. `my-org-bot`). Add it as a collaborator only on monitored repos. |
| Linear   | Linear API keys are workspace-wide. Use a dedicated service account where possible.                     |
| Slack    | The Slack app acts as its own bot user — no separate account needed.                                    |

---

## Token Scoping — Least Privilege

Grant each token only the permissions it actually needs.

**GitHub** — Use fine-grained personal access tokens:

- Scope to specific repositories (not the entire org or account)
- Repository permissions: **Contents** read/write + **Issues** read/write + **Pull requests** read/write only
- Never use classic tokens with full `repo` scope

**Linear** — API keys have full workspace access. Use a dedicated service account and treat the key as a high-value credential.

**Slack** — Only add the bot scopes listed in [slack.md](providers/slack.md). Do not add `admin.*` or other elevated scopes. Only invite the bot to channels it actually monitors.

---

## Event Filtering — Reducing Trigger Surface

Each provider has built-in default filters, but you can tighten them further to reduce the number of events that trigger agent sessions. Fewer triggers means less opportunity for unexpected or costly sessions.

Examples:

```yaml
# GitHub: only trigger on new issues and comments; ignore PRs entirely
options:
  eventFilter:
    issues: {}
    issue_comment: {}

# Linear: only trigger on issues in 'todo' or 'in progress' state
options:
  eventFilter:
    Issue:
      states: ['todo', 'in progress']

# Slack: only respond to @mentions (already the default, but made explicit)
options:
  eventFilter:
    app_mention: {}
```

See [configuration.md](configuration.md) for the full event filter reference, and the individual provider setup guides for provider-specific defaults.

---

## MCP Endpoint Access

MCP endpoints are declared as `type: INTERNAL` in the sandbox template, which means they are only reachable from within the sandbox — they are not publicly accessible from the internet. The `auth_proxy` is disabled on these endpoints because the `mcp-proxy` nginx container handles authentication by injecting the Bearer token on each request.

Do not change `type: INTERNAL` to a public type on MCP endpoints. Doing so would expose the MCP server to the public internet without authentication.
