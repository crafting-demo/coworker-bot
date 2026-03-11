# Slack Provider Setup

Set up coworker-bot to respond to @mentions in Slack and automatically dispatch a Crafting Coding Agent to handle them.

**Prerequisites:** Crafting CLI (`cs`) installed and authenticated as an org admin. A Slack workspace where you can create and install apps.

**Key behavior:** The Slack provider only triggers when the bot is @mentioned. This prevents the bot from responding to every message in high-traffic channels.

---

## Step 1 — Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App → From scratch**
3. Set:
   - **App Name:** `Auto Coder Bot` (or your preference)
   - **Workspace:** select your workspace
4. Click **Create App**

---

## Step 2 — Configure Bot Scopes

Navigate to **OAuth & Permissions** and add these Bot Token Scopes:

| Scope               | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `app_mentions:read` | Receive @mentions (webhook)                                  |
| `chat:write`        | Post messages                                                |
| `channels:history`  | Read public channel thread history (deduplication + context) |
| `groups:history`    | Read private channel thread history                          |
| `im:history`        | Read direct message thread history                           |
| `search:read`       | Search for missed mentions (polling mode)                    |

---

## Step 3 — Enable Event Subscriptions

Navigate to **Event Subscriptions**:

1. Toggle **Enable Events** to **On**
2. Set **Request URL** to your sandbox's webhook endpoint:
   ```
   https://webhook--coworker-bot-<your-org>.sandboxes.site/webhook/slack
   ```
   Slack will send a verification challenge. coworker-bot responds to it automatically — the URL should show a green checkmark.
3. Under **Subscribe to bot events**, add: `app_mention`
4. Click **Save Changes**

**Note:** If the sandbox isn't created yet, you can skip this step and come back after the sandbox is running. In the meantime the provider will use polling mode only.

---

## Step 4 — Install App to Workspace

1. Navigate to **Install App**
2. Click **Install to Workspace**
3. Review permissions and click **Allow**
4. **Copy the "Bot User OAuth Token"** (starts with `xoxb-`)

**Capture:** the bot token → `slack-bot-token` secret

---

## Step 5 — Get the Signing Secret

1. Navigate to **Basic Information**
2. Under **App Credentials**, find **Signing Secret**
3. Click **Show** and copy the value

**Capture:** the signing secret → `slack-signing-secret` secret

---

## MCP Prerequisites

The sandbox uses a Slack MCP server that gives Crafting Coding Agents access to Slack tools (search messages, read channel history, post messages, etc.).

How it works:

- The MCP server uses the `SLACK_MCP_XOXB_TOKEN` environment variable, which is set from the `slack-bot-token` secret in the sandbox template
- Message posting is **disabled by default** for safety. To enable posting in specific channels, set `SLACK_MCP_ADD_MESSAGE_TOOL=<channel_id>` (comma-separated for multiple channels) in the sandbox template's `env:` block
- The sandbox template handles the container setup automatically

**One-time authorization required:** After creating the sandbox, an org admin must authorize the MCP server. See [Part 2 of the setup guide](../README.md#4-authorize-mcp-servers).

---

## watcher.yaml Configuration

Reference configuration (dual webhook + polling mode for maximum reliability):

```yaml
providers:
  slack:
    enabled: true

    # Optional: polling as fallback for missed mentions
    # Recommended to catch mentions when webhooks fail or are temporarily unavailable
    pollingInterval: 300 # 5 minutes (300 seconds)

    auth:
      type: token
      tokenEnv: SLACK_BOT_TOKEN

    options:
      signingSecretEnv: SLACK_SIGNING_SECRET

      # Must be set to true to activate polling (Slack-specific opt-in)
      pollingEnabled: true

      initialLookbackHours: 1 # how far back to look on first poll
```

**No `botUsername` needed:** The Slack provider auto-detects the bot's user ID on startup.

### Dual mode: webhooks + polling

**Webhook mode (real-time):** Instant response to @mentions. Requires a publicly accessible endpoint (satisfied by the sandbox).

**Polling mode (fallback):** Searches for missed mentions using Slack's search API. Catches mentions when webhooks fail or are temporarily unavailable. Enable with `pollingEnabled: true` and a `pollingInterval`.

Best practice: enable both for reliability.

### Event filtering

By default, only `app_mention` events are processed. Use `eventFilter` to change this:

```yaml
options:
  eventFilter:
    app_mention: {} # default


    # Also handle direct messages:
    # message: {}
```

If `eventFilter` is omitted, only `app_mention` is processed.

### Thread handling

When the bot is mentioned in a thread:

- The bot replies in the same thread automatically
- The full thread conversation history is fetched and included in `resource.description` (formatted as `[timestamp] <@userId>: text` per message)
- Use `resource.description` in Handlebars templates when you need full thread context; `resource.comment.body` contains only the triggering mention text

---

## Troubleshooting

**Watcher fails to start — "No providers enabled"**

The env vars are not reaching the watcher. Check:

- Secrets exist: `cs secret list`
- Template references the correct secret names (`${secret:slack-bot-token}`, `${secret:slack-signing-secret}`)
- Sandbox was created from the updated template: `cs sandbox info coworker-bot`

**Webhooks not received — bot doesn't respond to mentions**

- Verify the sandbox is pinned (`cs sandbox pin coworker-bot`) — a suspended sandbox cannot receive webhooks
- Verify the Request URL is correct in Slack app settings → Event Subscriptions (should show a green checkmark)
- Verify the `app_mention` event is subscribed in Event Subscriptions
- Check sandbox logs for webhook validation errors
- Verify `SLACK_SIGNING_SECRET` matches the Slack app's signing secret

**Bot not responding after webhook is received**

- Verify the bot is added to the channel: `/invite @YourBot`
- Check bot token scopes (OAuth & Permissions) — all required scopes must be present
- Verify `SLACK_BOT_TOKEN` is set correctly
- If you added scopes after installing the app, reinstall the app to apply them (Install App → Reinstall to Workspace)

**Duplicate responses**

The bot responds multiple times to the same mention. Check sandbox logs on startup for the line `Slack bot user ID: U01ABC123` — the deduplication system uses this ID. If the bot user ID is not being detected correctly, check that the bot token is valid.

**"not_in_channel" or "missing_scope" errors**

- Add the bot to the channel: `/invite @YourBot`
- Verify bot scopes in Slack App → OAuth & Permissions
- Reinstall the app after adding scopes: Install App → Reinstall to Workspace

**Polling not working**

- Ensure `pollingEnabled: true` is set in `options`
- Verify `search:read` scope is present in the bot token scopes
- Check sandbox logs for API errors

**MCP tools not working**

MCP servers are not authorized. Repeat the authorization step (Web Console → **Connect → LLM** → **Sandboxes Authorized to Expose MCP Servers** → **Add**). Also confirm the sandbox is pinned (`cs sandbox pin coworker-bot`).
