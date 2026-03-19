# Setup Guide

Deploy coworker-bot on your Crafting site with one or more event providers. This guide covers all providers and is suitable for IaC / Config-as-Code workflows.

## Prerequisites

Before starting, make sure you have:

- **Crafting CLI (`cs`)** — installed and authenticated as an org admin (`cs auth login`)
- **A Crafting org** — with permission to create sandboxes, secrets, and templates
- **A dedicated bot account** — a separate account for each provider you use (GitHub user, Linear user, Slack bot app); must not be your personal account
- **Provider credentials** — API tokens and webhook secrets for each provider you want to enable (collected in Part 1 below)

---

## Part 1 — Configure Providers

Each provider requires its own credentials and, in some cases, an MCP server for the agent to act on your behalf. Follow the guide for each provider you want to use:

| Provider                      | Credentials needed                                    | MCP available                                  |
| ----------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| [GitHub](providers/github.md) | Fine-grained PAT + webhook secret                     | GitHub MCP server (container, auto-configured) |
| [Linear](providers/linear.md) | API key + webhook secret                              | Remote MCP at `https://mcp.linear.app/mcp`     |
| [Slack](providers/slack.md)   | Bot token + signing secret                            | Slack MCP server (container, auto-configured)  |
| [Jira](providers/jira.md)     | API token (Cloud) or PAT (Server/DC) + webhook secret | Community MCP server (manual setup)            |

Complete the relevant provider guide(s) before continuing. Each guide ends with a list of secrets to create; you will reference those secret names in Part 2.

---

## Part 2 — Configure the Sandbox

### 1. Create Crafting secrets

Create a Crafting secret for each credential you collected in the provider guides. Use the canonical secret names listed there (they must match the template's `${secret:...}` references exactly).

Example for GitHub (run in a separate terminal — never paste tokens into this chat):

```bash
echo "YOUR_TOKEN" | cs secret create github-pat --shared -f -
echo "YOUR_WEBHOOK_SECRET" | cs secret create github-webhook-secret --shared -f -
```

After creating each secret, open the Crafting Web Console and mark it as **Admin Only** and **Not Mountable**:

Web Console → **Secrets** → select the secret → **Edit** → check **Admin Only** and **Not Mountable** → Save.

- **Admin Only** — the secret is only accessible when the sandbox is in Restriction Mode, preventing the agent from reading its own credentials
- **Not Mountable** — the secret is never written to the filesystem; it is only available as an environment variable

### 2. Download and configure the template

Download the sandbox template into a local folder (gitignored, safe for customizations):

```bash
mkdir -p _local
curl -o _local/coworker-bot-full.yaml \
  https://raw.githubusercontent.com/crafting-demo/coworker-bot/refs/heads/master/templates/coworker-bot-full.yaml
```

Open the template and fill in the required values in the `env:` block. At minimum:

```yaml
env:
  - GITHUB_PERSONAL_ACCESS_TOKEN=${secret:github-pat} # already set
  - GITHUB_WEBHOOK_SECRET=${secret:github-webhook-secret} # already set


  # Optional — both are auto-detected from the PAT if not set:
  #   GITHUB_BOT_USERNAME    auto-detected via GET /user
  #   GITHUB_REPOSITORIES    auto-detected via GET /user/repos (fine-grained PATs return only scoped repos)
  # Uncomment to override:
  # - GITHUB_BOT_USERNAME=your-bot-github-username
  # - GITHUB_REPOSITORIES=owner/repo1,owner/repo2
```

See [docs/setup/configuration.md](configuration.md) for the full env var and `watcher.yaml` reference.

### 3. Create the template and sandbox

```bash
# Register the template with your Crafting site
cs template create coworker-bot ./_local/coworker-bot-quick-start.yaml

# Create the sandbox from the template
cs sandbox create coworker-bot -t coworker-bot

# Pin it so it stays running 24/7 to receive webhook events
cs sandbox pin coworker-bot
```

**MUST pin the sandbox.** Without pinning, the sandbox suspends after inactivity and misses webhook events. Events received while suspended are lost (polling will catch events from the past hour when it resumes, but real-time response requires the sandbox to be pinned).

### 4. Authorize MCP servers

This one-time step is required for providers with MCP support (GitHub, Linear, Slack). It allows Crafting Coding Agent sessions to use the MCP tools.

1. Open the **Crafting Web Console**
2. Navigate to **Connect → LLM**
3. Under **Sandboxes Authorized to Expose MCP Servers**, click **Add**
4. Input the sandbox name `coworker-bot` and confirm

**MUST:** Without this step, Coding Agent sessions cannot use MCP tools (GitHub, Linear, Slack actions) and will fail to read issues or create PRs.

### 5. Configure webhooks in your provider

Each provider has a specific webhook URL. Find yours in the Web Console: sandbox → **Endpoints** → **webhook** → copy the URL. It follows the pattern:

```
https://webhook--coworker-bot-<your-org>.sandboxes.site/webhook/<provider>
```

Configure the webhook in each provider's settings page. See the relevant provider guide for the exact steps and required fields.

### 6. Verify

```bash
cs logs --workspace coworker-bot/dev --follow watcher
```

Look for: `Watcher started successfully` and `Initialized provider: <name>`.

**Trigger a test event:** Create a new issue in one of your monitored repositories. Within ~30 seconds, the bot should post a comment: `"Agent is working on #<issue-number>"` and a Crafting Coding Agent session will start.

---

## Part 3 — Security & Operations

For a full security hardening checklist covering secrets, webhook signatures, token scoping, rotation, and Restriction Mode, see **[security.md](security.md)**.

### Token rotation

Rotate credentials on your standard schedule. After rotating any token:

```bash
echo "NEW_VALUE" | cs secret update <secret-name> -f -
cs sandbox restart coworker-bot
```

For webhook secrets, also update the secret value in the provider's webhook settings.

### Scope minimization

- **GitHub:** Fine-grained token scoped to specific repositories with Contents + Issues + Pull Requests read/write only. Avoid org-level tokens or classic tokens with full `repo` scope.
- **Linear:** API keys have full workspace access. Use a dedicated service account when possible.
- **Slack:** Restrict bot scopes to the minimum listed in [slack.md](providers/slack.md). Only invite the bot to channels it needs to monitor.

### Cost control

The pinned sandbox runs 24/7, so the primary cost driver is the node pool it runs on. To control costs:

- **Use a small node pool** — create a dedicated small node pool (or use an existing one) and assign the sandbox to it. Since the watcher process is lightweight, it does not need a large or general-purpose node.
- **Assign the sandbox to the node pool** — add a `schedule_spec` to the workspace in the sandbox template so the pinned sandbox always runs on the low-cost nodes:

```yaml
workspaces:
  - name: dev
    schedule_spec:
      selector:
        name: <your-node-pool-name>
```

See [Crafting docs — Schedule Spec](https://docs.sandboxes.cloud/features/schedule-spec.html) for details. Ensure the `selector.name` matches a configured node pool exactly, or the workload will fail to schedule.

### Restriction Mode

For stricter environments, enable Restriction Mode in the template to prevent the sandbox owner from accessing the workspace:

```yaml
restriction:
  life_time: ALWAYS
```

See [Crafting docs — Restriction Mode](https://docs.sandboxes.cloud/docs/restriction-mode) for details.

### Troubleshooting

For provider-specific troubleshooting, see the relevant provider guide:

- [GitHub troubleshooting](providers/github.md#troubleshooting)
- [Linear troubleshooting](providers/linear.md#troubleshooting)
- [Slack troubleshooting](providers/slack.md#troubleshooting)
- [Jira troubleshooting](providers/jira.md#troubleshooting)

**Watcher fails to start — "No providers enabled"**

The env vars are not reaching the watcher. Check:

- Secrets exist: `cs secret list`
- Template references the correct secret names (e.g. `${secret:github-pat}`)
- Sandbox was created from the updated template: `cs sandbox info coworker-bot`

**Agent sessions fail to use MCP tools**

MCP servers are not authorized. Repeat the authorization step in Part 2 (Web Console → **Connect → LLM** → **Sandboxes Authorized to Expose MCP Servers** → **Add**). Also confirm the sandbox is pinned (`cs sandbox pin coworker-bot`) — MCP servers are unavailable when the sandbox is suspended.
