# GitHub Provider Setup

Set up coworker-bot to monitor GitHub issues, PRs, and comments, and automatically dispatch a Crafting Coding Agent to handle them.

**Prerequisites:** Crafting CLI (`cs`) installed and authenticated as an org admin.

---

## Step 1 — Create a GitHub Bot Account

Create a dedicated GitHub account for the agent. This account will post comments and open PRs.

**MUST:** Use a separate account, not your personal GitHub account. The watcher skips events where the last comment is from this account — using your personal account would suppress events you create yourself.

After creating the account:

- Note the **username** → you will use it as `GITHUB_BOT_USERNAME`
- Add the bot account as a collaborator on the repositories it needs to write to (Settings → Collaborators → Add people)

---

## Step 2 — Create a GitHub Personal Access Token

Create a fine-grained token for the bot account. Sign in as the bot account to do this.

**External docs:** [GitHub — Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

Steps:

1. Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Set:
   - **Token name:** `coworker-bot` (or your preferred name)
   - **Expiration:** choose based on your rotation policy
   - **Resource owner:** the org or user that owns the repositories
   - **Repository access:** select the specific repositories to monitor
   - **Repository permissions:**
     - Contents: **Read and write**
     - Issues: **Read and write**
     - Pull requests: **Read and write**
     - Metadata: Read-only (auto-included)

**MUST:** Use a fine-grained token scoped to specific repositories. DON'T use a classic token with full `repo` scope — it grants far more access than needed.

**Capture:** the token value (shown once) → `github-pat` secret

---

## Step 3 — Generate a Webhook Secret

Generate a random string to use as the webhook signing secret. This allows the watcher to verify that incoming webhook requests actually come from GitHub.

```bash
openssl rand -hex 32
```

**Capture:** the output value → `github-webhook-secret` secret

---

## MCP Prerequisites

The sandbox runs a GitHub MCP server that gives Crafting Coding Agents access to GitHub tools (read issues, create PRs, etc.). The sandbox template handles the container setup automatically — you do not need to configure it manually.

How it works:

- A `github-mcp` container runs the GitHub MCP server
- An nginx `mcp-proxy` container sits in front of it and injects `GITHUB_PERSONAL_ACCESS_TOKEN` as a Bearer token on every request
- The MCP endpoint is registered so all Crafting Coding Agent sessions inside the sandbox can use GitHub tools

**One-time authorization required:** After creating the sandbox, an org admin must authorize the MCP server. See [Part 2 of the setup guide](../README.md#4-authorize-mcp-servers).

---

## watcher.yaml Configuration

The watcher auto-configures from environment variables set in the sandbox template, so a `watcher.yaml` file is not required for standard setups. If you need custom event filters, multiple repositories, or non-default polling, inject a `watcher.yaml` via the template's `files:` block (see the commented example in `docs/examples/templates/coworker-bot-quick-start.yaml`).

Reference configuration:

```yaml
providers:
  github:
    enabled: true
    pollingInterval: 60 # seconds between polls (default: 60)

    auth:
      type: token
      tokenEnv: GITHUB_PERSONAL_ACCESS_TOKEN

    options:
      webhookSecretEnv: GITHUB_WEBHOOK_SECRET
      botUsername: your-bot-github-username # from Step 1

      # Repositories to monitor for polling (webhooks work without this)
      repositories:
        - owner/repo1
        - owner/repo2

      initialLookbackHours: 1 # how far back to look on first poll
      maxItemsPerPoll: 50 # cap items processed per poll cycle
```

### Event filtering

**Default filtering:**

- ✅ `issues` — all actions processed
- ❌ `pull_request` — skips `opened`, `synchronize`, `edited`, `labeled`, `unlabeled`, `assigned`, `unassigned`, `locked`, `unlocked`
- ✅ `issue_comment` — all actions processed
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

## Step 4 — Configure the GitHub Webhook

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
4. Set **Secret** to the value you generated in Step 3
5. Under **Which events**, select **Let me select individual events**, then check:
   - **Issues**
   - **Pull requests**
   - **Issue comments**
6. Ensure **Active** is checked
7. Click **Add webhook**

GitHub will send a ping event. The webhook should show a green checkmark in the **Recent Deliveries** tab.

---

## Troubleshooting

**Watcher fails to start — "No providers enabled"**

The env vars are not reaching the watcher. Check:

- Secrets exist: `cs secret list`
- Template references the correct secret names (`${secret:github-pat}`, `${secret:github-webhook-secret}`)
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

`GITHUB_BOT_USERNAME` doesn't match the bot's actual GitHub username. Check the exact username at github.com and update the env var in the template, then re-deploy:

```bash
cs template update coworker-bot ./_local/coworker-bot-quick-start.yaml
cs sandbox restart coworker-bot
```

**Coding Agent sessions fail to use GitHub tools**

MCP servers are not authorized. Repeat the authorization step (Web Console → **Connect → LLM** → **Sandboxes Authorized to Expose MCP Servers** → **Add**). Also confirm the sandbox is pinned (`cs sandbox pin coworker-bot`) — the MCP server is unavailable when the sandbox is suspended.

**Agent triggers on the wrong events**

Use `eventFilter` in `watcher.yaml` (or injected via the template's `files:` block) to control exactly which event types and actions trigger sessions. See `config/watcher.full.yaml` for the full filter reference.

**Polling not working**

- Verify `GITHUB_PERSONAL_ACCESS_TOKEN` is set correctly
- Check token permissions (Contents + Issues + PRs read/write)
- Ensure `repositories` are configured in `options`
- Check sandbox logs for authentication errors

**Rate limiting (403 with "rate limit exceeded")**

- Increase `pollingInterval` to reduce API calls
- Use `maxItemsPerPoll` to limit items per poll
- Authenticated requests have 5,000 requests/hour; rely on webhooks as the primary trigger
