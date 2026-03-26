# GitHub Provider Setup

Set up coworker-bot to monitor GitHub issues, PRs, and comments, and automatically dispatch a Crafting Coding Agent to handle them.

**Prerequisites:** Crafting CLI (`cs`) installed and authenticated as an org admin.

---

## Authentication Modes

There are two ways to authenticate the GitHub provider:

### Mode 1 — GitHub App (recommended)

Uses a GitHub App installation token injected automatically by the Crafting mcp-proxy. No token needs to be configured manually.

- **`GITHUB_ORG`** — org where the GitHub App is installed (enables this mode)
- **`GITHUB_BOT_USERNAME`** — **required for deduplication**; must be set to the GitHub App's bot username. GitHub automatically appends `[bot]` to every App's login — so if your app is named `my-app`, the bot username is `my-app[bot]`. Installation tokens cannot call `GET /user`, so this cannot be auto-detected. Find the exact value by looking at a comment already posted by the app in GitHub, or in your GitHub App settings page.

### Mode 2 — PAT / Bot User

Uses a Personal Access Token belonging to a dedicated GitHub bot user account.

- **`auth.tokenEnv`** in `watcher.yaml` — points to the env var holding the PAT
- **`botUsername`** — optional; auto-detected from the token via `GET /user` if not set. The detected username is the GitHub login of the PAT owner.
- **`repositories`** — required for polling; must be set explicitly. `GET /installation/repositories` is a GitHub App-only endpoint and does not work with PATs.

```yaml
providers:
  github:
    auth:
      tokenEnv: GITHUB_TOKEN # env var holding the Personal Access Token
    options:
      # botUsername is auto-detected from the token if omitted
      webhookSecretEnv: GITHUB_WEBHOOK_SECRET
      repositories: # required for polling in PAT mode
        - owner/repo1
        - owner/repo2
```

---

## Step 1 — Connect GitHub

### GitHub App mode

Connect your GitHub App to the Crafting org so the sandbox can authenticate with GitHub.

> **Note:** GitHub App integration requires self-hosting setup. Ask Crafting for the **"GitHub App in Self-Hosting"** guide before proceeding.

In the **Crafting Web Console → Connect → GitHub**: connect to your GitHub App and the org repos you want the agent to access.

After connecting:

- Note the **org name** where the app is installed → `GITHUB_ORG`
- Set `GITHUB_BOT_USERNAME` to the GitHub App's bot username. GitHub automatically appends `[bot]` to the app's login (e.g. if your app is named `my-app`, the bot username is `my-app[bot]`). See Mode 1 above.

The app installation token is automatically injected by the mcp-proxy — no token secret needs to be created manually.

### PAT mode

1. Create a dedicated GitHub user account for the bot (or use an existing bot account)
2. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens** (or classic tokens)
3. Generate a PAT with these permissions:
   - **Issues**: Read & Write
   - **Pull requests**: Read & Write
   - **Contents**: Read (needed to read repo data)
   - **Checks**: Read — required for `check_run` webhook events (`watchChecks`)
   - **Commit statuses**: Read — required for `status` webhook events (legacy CI)
4. Store the token as a Crafting secret:

```bash
echo "YOUR_PAT_HERE" | cs secret create github-pat --shared -f -
```

5. Reference it in your sandbox template's `env:` block:

```yaml
- GITHUB_TOKEN=${secret:github-pat}
```

Then in `watcher.yaml`, configure the `auth` block as shown in Mode 2 above.

---

## Step 2 — Generate a Webhook Secret

Generate a random string to use as the webhook signing secret. This allows the watcher to verify that incoming webhook requests actually come from GitHub.

```bash
openssl rand -hex 32
```

**Capture:** the output value → `github-webhook-secret` secret

```bash
echo "$(openssl rand -hex 32)" | cs secret create github-webhook-secret --shared -f -
```

**MUST** mark this secret as **Admin Only** and **Not Mountable** in the Web Console (Secrets → Edit) so it is never written to the filesystem.

---

## MCP Prerequisites

The sandbox runs a GitHub MCP server that gives Crafting Coding Agents access to GitHub tools (read issues, create PRs, etc.). The sandbox template handles the container setup automatically — you do not need to configure it manually.

How it works:

- A `github-mcp` container runs the GitHub MCP server
- An nginx `mcp-proxy` container sits in front of it and injects the GitHub App installation token as a Bearer token on every request
- The MCP endpoint is registered so all Crafting Coding Agent sessions inside the sandbox can use GitHub tools

**One-time authorization required:** After creating the sandbox, an org admin must authorize the MCP server. See [Part 2 of the setup guide](../README.md#4-authorize-mcp-servers).

---

## watcher.yaml Configuration

The watcher auto-configures from environment variables set in the sandbox template, so a `watcher.yaml` file is not required for standard setups. If you need custom event filters, multiple repositories, or non-default polling, inject a `watcher.yaml` via the template's `files:` block (see the commented example in `docs/examples/templates/coworker-bot-quick-start.yaml`).

**GitHub App mode** (no `auth:` block — token injected by mcp-proxy via `GITHUB_ORG`):

```yaml
providers:
  github:
    enabled: true
    pollingInterval: 60 # seconds between polls (default: 60)
    options:
      webhookSecretEnv: GITHUB_WEBHOOK_SECRET
      botUsername: my-app[bot] # required — installation tokens cannot auto-detect this
      # repositories: auto-detected from the installation token if not set
      initialLookbackHours: 1
      maxItemsPerPoll: 50
```

**PAT mode** (`auth:` block with the token env var):

```yaml
providers:
  github:
    enabled: true
    pollingInterval: 60
    auth:
      tokenEnv: GITHUB_TOKEN # env var holding the Personal Access Token
    options:
      webhookSecretEnv: GITHUB_WEBHOOK_SECRET
      # botUsername: auto-detected via GET /user if omitted
      repositories: # required in PAT mode — no installation API available
        - owner/repo1
        - owner/repo2
      initialLookbackHours: 1
      maxItemsPerPoll: 50
```

### Watching CI check failures

To have the bot automatically react when a CI check fails on a pull request, enable `watchChecks`:

```yaml
options:
  watchChecks: true
```

When `watchChecks: true`, any failed check run (conclusion: `failure`, `timed_out`, `cancelled`, `action_required`) on an open PR triggers the bot — no assignment or @mention needed. The bot receives the PR details plus the check name and failure output so it can investigate and fix the failure.

Alternatively, you can use `triggerLabels` to gate check failure handling on a specific label:

```yaml
options:
  triggerLabels:
    - ai-fix # only react to check failures on PRs with this label
```

When a `triggerLabel` is set, check failures are processed only for PRs that carry a matching label — without requiring `watchChecks: true`.

**Two check event types** — subscribe to whichever your CI system uses:

| Event type  | Used by                                      | GitHub App permission required |
| ----------- | -------------------------------------------- | ------------------------------ |
| `check_run` | GitHub Actions, CircleCI, most modern CI     | **Checks** — Read              |
| `status`    | Buildkite (OAuth mode), some legacy CI tools | **Commit statuses** — Read     |

Both event types are handled identically by the bot after normalization. Enable both in your webhook/GitHub App settings if you are unsure which your CI uses.

See Step 3 below for how to subscribe to these events in your GitHub webhook or GitHub App settings.

---

### Event filtering

**Default filtering:**

- ✅ `issues` — all actions processed
- ❌ `pull_request` — skips `opened`, `synchronize`, `edited`, `labeled`, `unlabeled`, `assigned`, `unassigned`, `locked`, `unlocked`
- ✅ `issue_comment` — all actions processed
- ✅ `check_run` — only `completed` action; only failure conclusions; requires `watchChecks: true` or a matching `triggerLabel`
- ✅ `status` — only `failure`/`error` states; requires `watchChecks: true` or a matching `triggerLabel`
- ❌ Any closed/merged item (unless action is `reopened`)

Use `eventFilter` to override which event types and actions trigger sessions:

```yaml
options:
  eventFilter:
    # Accept all issue actions, but skip 'labeled'
    issues:
      actions: ['all']
      skipActions: ['labeled']

    # Only process explicitly closed or reopened PRs
    pull_request:
      actions: ['closed', 'reopened']

    # Accept all issue_comment actions
    issue_comment: {}
```

- **`actions`** — allowlist of actions to process. Use `['all']` (the default) to accept every action.
- **`skipActions`** — denylist applied after the allowlist. Actions listed here are always skipped.
- If `eventFilter` is **omitted**, the built-in defaults above apply.
- If `eventFilter` is **present**, only the listed event types are processed.

**Common recipes:**

```yaml
# Only trigger when a PR is merged
pull_request:
  actions: ['closed'] # merged PRs arrive with action='closed'

# Watch PRs and issue_comment only (ignore issues entirely)
eventFilter:
  pull_request: {}
  issue_comment: {}
```

---

## Step 3 — Configure the GitHub Webhook

**External docs:** [GitHub — Creating webhooks](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks)

Find the webhook URL for your sandbox:

```
https://webhook--coworker-bot-<your-org>.sandboxes.site/webhook/github
```

You can also find it in the Web Console: select the sandbox → **Endpoints** → **webhook** → copy the URL.

For each repository you want to monitor:

1. Go to the repository → **Settings → Webhooks → Add webhook**
2. Set **Payload URL** to the URL above
3. Set **Content type** to `application/json` — **MUST**, not `application/x-www-form-urlencoded`
4. Set **Secret** to the value you generated in Step 2
5. Under **Which events**, select **Let me select individual events**, then check:
   - **Issues**
   - **Pull requests**
   - **Issue comments**
   - **Check runs** — required for `watchChecks` / CI check failure handling (GitHub Actions, CircleCI, etc.)
   - **Commit statuses** — required if your CI uses the legacy Status API (e.g. Buildkite in OAuth mode)
6. Ensure **Active** is checked
7. Click **Add webhook**

GitHub will send a ping event. The webhook should show a green checkmark in the **Recent Deliveries** tab.

---

## Troubleshooting

**Watcher fails to start — "No providers enabled"**

The env vars are not reaching the watcher. Check:

- Secrets exist: `cs secret list`
- Template references the correct secret names (`${secret:github-webhook-secret}`)
- Sandbox was created from the updated template: `cs sandbox info coworker-bot`

**Webhook events not received**

- Verify the sandbox is pinned (`cs sandbox pin coworker-bot`) — a suspended sandbox cannot receive webhooks
- Verify the webhook URL is correct (Web Console → Endpoints → webhook)
- Check GitHub webhook delivery log: repository → Settings → Webhooks → Recent Deliveries
- Verify content type is `application/json`
- Check sandbox logs for signature validation errors

**Webhook signature validation fails**

- Verify `GITHUB_WEBHOOK_SECRET` matches the secret configured in GitHub webhook settings
- Check that the webhook secret is not empty
- Ensure the webhook is configured with `application/json` content type

**Bot posts duplicate comments / responds to itself**

`GITHUB_BOT_USERNAME` is not set or doesn't match the GitHub App's actual bot username. GitHub App installation tokens cannot auto-detect this — it must be set explicitly. Check the exact username (e.g. `my-app[bot]`) by looking at a comment already posted by the app in GitHub, then update the env var in the template and re-deploy:

```bash
cs template update coworker-bot ./_local/coworker-bot-quick-start.yaml
cs sandbox restart coworker-bot
```

**Coding Agent sessions fail to use GitHub tools**

MCP servers are not authorized. Repeat the authorization step (Web Console → **Connect → LLM** → **Sandboxes Authorized to Expose MCP Servers** → **Add**). Also confirm the sandbox is pinned (`cs sandbox pin coworker-bot`) — the MCP server is unavailable when the sandbox is suspended.

**Agent triggers on the wrong events**

Use `eventFilter` in `watcher.yaml` (or injected via the template's `files:` block) to control exactly which event types and actions trigger sessions. See `config/watcher.full.yaml` for the full filter reference.

**403 "Resource not accessible by integration" when posting comments**

The GitHub App is missing write permissions. In your GitHub App settings (Settings → Developer settings → GitHub Apps → your app → Permissions & events), ensure:

- **Issues**: Read & Write
- **Pull requests**: Read & Write

After updating permissions, re-approve the installation in your org's GitHub App settings page (a prompt will appear). Then restart the sandbox:

```bash
cs sandbox restart coworker-bot
```

---

**Rate limiting (403 with "rate limit exceeded")**

- Increase `pollingInterval` to reduce API calls
- Use `maxItemsPerPoll` to limit items per poll
- Rely on webhooks as the primary trigger to reduce polling load
