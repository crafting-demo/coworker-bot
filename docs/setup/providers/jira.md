# Jira Provider Setup

Set up coworker-bot to monitor Jira issues and comments, and automatically dispatch a Crafting Coding Agent to handle them.

**Prerequisites:** Crafting CLI (`cs`) installed and authenticated as an org admin. A Jira account with admin access to configure system webhooks.

**External docs:** [Jira Cloud REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) · [Jira Server REST API](https://docs.atlassian.com/software/jira/docs/api/REST/latest/)

---

## Step 1 — Create a Jira Bot Account

Create a dedicated Atlassian account for the agent. This account will post comments and is used to determine which issues the bot should work on.

**MUST:** Use a separate account, not your personal Jira account. The watcher uses this account's display name for deduplication — using your personal account would cause the bot to skip issues you interact with yourself.

After creating the account:

- Invite it to your Jira project(s) with **Developer** or equivalent permissions (must be able to comment and be assigned issues)
- Note the account's **display name** exactly as shown in Jira (e.g. `"Coworker Bot"`) → you will use it as `JIRA_BOT_USERNAME`

**How events are triggered:**

- **Issue events** — the bot only processes issues where it is **assigned** as the assignee. Assign an issue to the bot account to trigger it.
- **Comment events** — the bot only processes comments that **@mention** its display name. Mention the bot by name in a comment to trigger it.

---

## Step 2 — Create Authentication Credentials

Choose the method that matches your Jira deployment.

### Option A: Jira Cloud (API token — recommended)

**External docs:** [Manage API tokens — Atlassian](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)

1. Sign in to Jira as the bot account
2. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
3. Click **Create API token**
4. Set:
   - **Label:** `coworker-bot`
   - **App:** Jira
   - **Scope:** Classic
   - **Scope Actions:**
     - `read:jira-work` — read issues, comments, and attachments
     - `write:jira-work` — create and update issues and comments
     - `read:jira-user` — read user and group information
5. Click **Create** and **copy the token immediately** — it will not be shown again

**Capture:**

- The bot account email → `JIRA_EMAIL` env var
- The API token → `jira-api-token` secret

### Option B: Jira Server / Data Center (Personal Access Token)

**External docs:** [Using Personal Access Tokens — Atlassian](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)

1. Sign in to Jira as the bot account
2. Go to your profile → **Personal Access Tokens** → **Create token**
3. Set:
   - **Token name:** `coworker-bot`
   - **Expiry:** based on your rotation policy
4. Click **Create** and **copy the token immediately**

**Capture:** the PAT → `jira-api-token` secret

---

## Step 3 — Get the Webhook Secret

Jira generates a webhook secret for you when you create the webhook (Step 4). You do not need to create one manually.

**Capture:** the secret Jira displays after webhook creation → `jira-webhook-secret` secret

---

## MCP Prerequisites

The sandbox template uses [Atlassian's hosted Remote MCP server](https://mcp.atlassian.com) (`mcp.atlassian.com/v1/mcp`). This gives the Crafting Coding Agent tools to read and write Jira issues and comments directly.

## The `mcp-proxy` nginx container injects `Authorization: Bearer ${JIRA_API_TOKEN}` on every request to the MCP server. The token must be a valid Atlassian API token with sufficient Jira permissions.

## watcher.yaml Configuration

Reference configuration:

```yaml
providers:
  jira:
    enabled: true
    pollingInterval: 60 # seconds between polls (default: 60)

    # Option A: Jira Cloud (email + API token)
    auth:
      type: basic
      username: bot@yourcompany.com # bot account email
      tokenEnv: JIRA_API_TOKEN

    # Option B: Jira Server/DC or Jira Cloud (Personal Access Token)
    # auth:
    #   type: token
    #   tokenEnv: JIRA_PERSONAL_ACCESS_TOKEN

    options:
      # Base URL of your Jira instance (required)
      # Jira Cloud:  https://yourcompany.atlassian.net
      # Jira Server: https://jira.yourcompany.com
      baseUrl: https://yourcompany.atlassian.net

      webhookSecretEnv: JIRA_WEBHOOK_SECRET

      # Bot display name for deduplication — must match the Jira display name exactly (case-insensitive)
      # If omitted, auto-detected from the authenticated credentials.
      botUsername: 'Coworker Bot'

      # Projects to monitor for polling (uses Jira project keys, e.g. "PROJ", "ENG")
      # Omit to poll all accessible projects.
      projects:
        - PROJ
        - ENG

      initialLookbackHours: 1 # how far back to look on first poll
      maxItemsPerPoll: 50 # cap items processed per poll cycle


      # Issue statuses to skip (case-insensitive)
      # Default: done, closed, resolved, cancelled, won't fix
      # skipStatuses:
      #   - done
      #   - closed
      #   - resolved
      #   - cancelled
      #   - won't fix
```

**Finding your project keys:** Project keys are the short uppercase identifiers that prefix issue numbers (e.g., in `PROJ-123`, the project key is `PROJ`). They appear in Jira → Project Settings → Details.

**Bot display name:** Must match the account's display name as shown in Jira exactly (case-insensitive). Run with `logLevel: debug` to see which value is returned if you're unsure.

### Event filtering

**Default filtering:**

- ✅ Issues assigned to the bot account are processed
- ✅ Comments that @mention the bot display name are processed
- ❌ Issues in `done`, `closed`, `resolved`, `cancelled`, or `won't fix` status are skipped
- ❌ Issues not assigned to the bot are skipped
- ❌ Comments that do not @mention the bot are skipped

Use `skipStatuses` to customize which statuses are skipped:

```yaml
options:
  skipStatuses:
    - done
    - closed
    - resolved
    - cancelled
    - won't fix
    - your-custom-status
```

**Common recipes:**

```yaml
# Process all statuses (disable status filtering)
skipStatuses: []

# Skip additional custom statuses
skipStatuses:
  - done
  - closed
  - resolved
  - cancelled
  - won't fix
  - waiting for review
  - blocked
```

---

## Step 4 — Configure the Jira Webhook

**External docs:** [Webhooks — Jira Cloud](https://developer.atlassian.com/server/jira/platform/webhooks/)

Find the webhook URL for your sandbox:

```
https://webhook--coworker-bot-<your-org>.sandboxes.site/webhook/jira
```

You can also find it in the Web Console: select the sandbox → **Endpoints** → **webhook** → copy the URL.

**Registering the webhook in Jira Cloud:**

1. Go to **Settings (gear icon) → System → WebHooks**
   - (Requires Jira admin access)
2. Click **Create a WebHook**
3. Set:
   - **Name:** `coworker-bot`
   - **Status:** Enabled
   - **URL:** the webhook URL above
4. Under **Issue related events**, check:
   - `created`
   - `updated`
5. Under **Comment**, check:
   - `created`
   - `updated`
6. Optionally add a **JQL filter** to limit which issues trigger the webhook (e.g., `project in (PROJ, ENG)`)
7. Click **Create**
8. **Copy the secret** Jira displays after creation — this is your `jira-webhook-secret`

Jira generates the secret and uses it to sign payloads with an HMAC-SHA256 signature in the `X-Hub-Signature` header.

---

## Troubleshooting

**Watcher fails to start — "No providers enabled"**

The env vars are not reaching the watcher. Check:

- Secrets exist: `cs secret list`
- Template references the correct secret names (`${secret:jira-api-token}`, `${secret:jira-webhook-secret}`)
- Sandbox was created from the updated template: `cs sandbox info coworker-bot`

**Webhook events not received**

- Verify the sandbox is pinned (`cs sandbox pin coworker-bot`) — a suspended sandbox cannot receive webhooks
- Verify the webhook URL is correct (Web Console → Endpoints → webhook)
- Check Jira webhook delivery log: Settings → System → WebHooks → select webhook → **View logs**
- Check sandbox logs for signature validation errors

**Webhook signature validation fails**

- Verify `JIRA_WEBHOOK_SECRET` matches the secret entered in Jira's webhook settings exactly
- Ensure the secret field was not left blank when creating the webhook in Jira
- Jira signs payloads with HMAC-SHA256 in the `X-Hub-Signature: sha256=<hex>` header — the watcher validates this automatically

**Bot does not process issues**

The most common cause is that the bot account is not assigned to the issue. Jira issue events only trigger the bot when the bot's account is the assignee. Assign the issue to the bot account and verify the assignee display name matches `botUsername`.

Run with `logLevel: debug` to see:

```
[Jira dedup] issue PROJ-123 assignees: ["..."], bot usernames: ["..."]
```

If the values don't match, update `botUsername` to match the exact display name shown in Jira.

**Bot does not process comments**

Comments only trigger the bot when the bot's display name is mentioned in the comment text. Mention the bot by its display name (e.g., `@Coworker Bot please fix this`) and verify the name matches `botUsername`.

**Bot posts duplicate comments / responds to itself**

`botUsername` doesn't match the bot account's actual Jira display name. The watcher checks the last comment author — if it can't identify the bot's own comments, it will keep processing the same issue. Run with `logLevel: debug` and look for the `[Jira dedup]` log line to compare values.

**Authentication errors (401 / 403)**

- For Jira Cloud (basic auth): verify `JIRA_EMAIL` is the bot account's email, and `JIRA_API_TOKEN` is a valid API token generated from that account
- For Jira Server/DC (token auth): verify the PAT hasn't expired and the account has access to the monitored projects
- Ensure the token is set correctly: `cs secret list` shows the secret exists; check it hasn't been rotated without updating the sandbox

**Issues in closed/done status still processing**

- Custom Jira workflow state names may not match the defaults (`done`, `closed`, `resolved`, `cancelled`, `won't fix`)
- Run with `logLevel: debug` to see which status name Jira reports
- Add the custom status to `skipStatuses`:
  ```yaml
  options:
    skipStatuses:
      - done
      - closed
      - resolved
      - your-custom-status
  ```

**Polling not working**

- Verify `baseUrl` is set correctly and does not have a trailing slash
- Verify `projects` lists valid project keys (short uppercase IDs, not project names)
- Jira's search index has a short propagation delay — events may appear in polls 1–2 minutes after creation
- Check sandbox logs for JQL or authentication errors

**Rate limiting (429 errors)**

- Increase `pollingInterval` to reduce API calls (Jira Cloud allows ~300 requests/10 minutes for most endpoints)
- Use `maxItemsPerPoll` to limit items per cycle
- Use `projects` to narrow the JQL scope so fewer issues are returned per poll
