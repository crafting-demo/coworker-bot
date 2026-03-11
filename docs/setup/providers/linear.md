# Linear Provider Setup

Set up coworker-bot to monitor Linear issues and automatically dispatch a Crafting Coding Agent to handle them.

**Prerequisites:** Crafting CLI (`cs`) installed and authenticated as an org admin. A Linear account with access to the teams/issues you want to monitor.

**External docs:** [Linear — API & Webhooks](https://linear.app/docs/api-and-webhooks)

---

## Step 1 — Generate a Linear API Key

1. Go to [Linear Settings → API → Personal API keys](https://linear.app/settings/api)
2. Under **Personal API keys**, click **Create key**
3. Set:
   - **Label:** `coworker-bot` (or your preferred name)
4. Click **Create key** and **copy the generated key immediately** — it will not be shown again

**Important:** Linear API keys have full access to your workspace data. Keep them secure and never commit them to version control.

**Capture:** the API key → `linear-pat` secret

---

## Step 2 — Create a Linear Webhook

1. Go to [Linear Settings → API → Webhooks](https://linear.app/settings/api)
2. Click **Create webhook**
3. Set:
   - **Webhook URL:** `https://webhook--coworker-bot-<your-org>.sandboxes.site/webhook/linear` (fill in after sandbox is created — you can update this later)
   - **Label:** `coworker-bot`
   - **Resource types:** check **Issue** and **Comment**
4. Click **Create webhook**
5. **Copy the webhook secret** — Linear generates and displays it after creation. Copy it immediately; it may not be shown again.

**Capture:** the webhook secret → `linear-webhook-secret` secret

---

## MCP Prerequisites

The sandbox uses the Linear remote MCP server at `https://mcp.linear.app/mcp`, which gives Crafting Coding Agents access to Linear tools (read issues, create comments, update status, etc.).

How it works:

- The sandbox nginx proxy runs on port 8080 and injects `LINEAR_API_TOKEN` as a Bearer token on every MCP request
- The sandbox template handles the proxy setup automatically — you do not need to configure it manually

**One-time authorization required:** After creating the sandbox, an org admin must authorize the MCP server. See [Part 2 of the setup guide](../README.md#4-authorize-mcp-servers).

---

## watcher.yaml Configuration

The watcher runs both webhook and polling modes simultaneously — both are always enabled and cannot be disabled independently. This ensures reliable event delivery: webhooks provide real-time updates while polling catches any missed events.

Reference configuration:

```yaml
providers:
  linear:
    enabled: true
    pollingInterval: 60 # seconds between polls (default: 60)

    auth:
      type: token
      tokenEnv: LINEAR_API_TOKEN

    options:
      webhookSecretEnv: LINEAR_WEBHOOK_SECRET
      botUsername: your-linear-username # Linear display name or username, for deduplication

      # Teams to monitor (for polling). Team keys are short IDs like "ENG", "DESIGN".
      # Omit to monitor all teams in your workspace.
      teams:
        - ENG
        - PRODUCT

      initialLookbackHours: 1 # how far back to look on first poll
      maxItemsPerPoll: 50 # cap items processed per poll cycle
```

**Finding your team keys:** Go to Linear → Settings → Teams. The key is the short identifier shown next to each team name (e.g., "ENG", "DES"). Team keys also appear in issue IDs (e.g., "ENG-123" → team key is "ENG").

**Bot username:** Use your Linear display name or username. Run with `logLevel: debug` to see which format Linear returns if you're unsure.

### Event filtering

**Default filtering:**

- ✅ `Issue` events are processed
- ❌ Issues in `done`, `cancelled`, or `canceled` state are skipped
- ❌ `Comment` events are ignored unless explicitly configured

Use `eventFilter` to override which event types and states trigger sessions:

```yaml
options:
  eventFilter:
    # Process all Issue states except 'done' and 'cancelled'
    Issue:
      states: ['all']
      skipStates: ['done', 'cancelled', 'canceled']

    # Also handle Comment events
    Comment: {}
```

- **`states`** — allowlist of state names (lowercase) to process. Use `['all']` to accept every state.
- **`skipStates`** — denylist applied after the allowlist.
- If `eventFilter` is **omitted**, the built-in defaults above apply.
- If `eventFilter` is **present**, only the listed event types are processed.

**Common recipes:**

```yaml
# Also process 'done' issues (e.g. to trigger a completion workflow)
Issue:
  states: ['all']
  skipStates: []

# Only process issues in specific states
Issue:
  states: ['in progress', 'in review']

# Ignore Issue events entirely, only handle Comments
eventFilter:
  Comment: {}
```

---

## Troubleshooting

**Watcher fails to start — "No providers enabled"**

The env vars are not reaching the watcher. Check:

- Secrets exist: `cs secret list`
- Template references the correct secret names (`${secret:linear-pat}`, `${secret:linear-webhook-secret}`)
- Sandbox was created from the updated template: `cs sandbox info coworker-bot`

**Webhook events not received**

- Verify the sandbox is pinned (`cs sandbox pin coworker-bot`) — a suspended sandbox cannot receive webhooks
- Verify the webhook URL is correct (Web Console → Endpoints → webhook)
- Check Linear webhook delivery log: Settings → API → Webhooks → select webhook → **Deliveries** tab
- Verify webhook secret matches configuration
- Check sandbox logs for signature validation errors
- Ensure the webhook is enabled in Linear settings

**Webhook signature validation fails**

- Verify `LINEAR_WEBHOOK_SECRET` matches the secret generated by Linear when you created the webhook
- If unsure, delete and recreate the Linear webhook to get a fresh secret

**Bot posts duplicate comments / responds to itself**

`botUsername` doesn't match your Linear account identifier. Run with `logLevel: debug` to see which identifier Linear returns in events, then update `botUsername` to match.

**Issues in "Done" state still processing**

- Custom Linear state names might not match the defaults (`done`, `cancelled`, `canceled`)
- Run with `logLevel: debug` to see which state name Linear reports for your issues
- Add the custom state name to `skipStates`:
  ```yaml
  options:
    eventFilter:
      Issue:
        skipStates: ['done', 'cancelled', 'canceled', 'your-custom-state']
  ```

**Authentication errors**

- Regenerate the Linear API key at Settings → API → Personal API keys
- Verify the key is set correctly and hasn't been revoked
- Ensure your Linear account has access to the teams you're monitoring

**Rate limiting (429 errors)**

- Increase `pollingInterval` to reduce API calls
- Use `maxItemsPerPoll` to limit items per poll
- Linear API allows ~1,000 requests per minute per user
