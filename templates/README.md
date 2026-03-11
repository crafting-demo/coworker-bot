# Sandbox Template

This folder contains Crafting Sandbox templates for the coworker-bot agent. Each template references secrets using the `${secret:<name>}` syntax — these must be configured in your Crafting Sandbox before the sandbox will start successfully.

## How Secrets Work in Crafting Sandbox

Secrets are injected as environment variables at runtime. You configure them once in the Crafting Sandbox UI and reference them in templates as `${secret:<secret-name>}`.

To add a secret:

1. Open your Crafting Sandbox dashboard
2. Navigate to **Settings → Secrets**
3. Click **Add Secret**, enter the name and value, and save

The secret name must exactly match what is referenced in the template (e.g., `github-pat`, not `github_pat`).

---

## Secrets Reference

### `github-pat`

**Used as:** `GITHUB_PERSONAL_ACCESS_TOKEN`

A GitHub Personal Access Token (classic) used to authenticate the GitHub MCP server and webhook handler.

**How to create:**

1. Go to [github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Set an expiration and select the following scopes:
   - `repo` (full repository access)
   - `read:org` (if working with org repositories)
4. Click **Generate token** and copy the value immediately
5. Add it to Crafting Sandbox as secret name `github-pat`

> Note: Some templates use `github_pat` (underscore). Make sure the secret name in Crafting Sandbox matches what is referenced in the template you are using.

---

### `linear-pat`

**Used as:** `LINEAR_API_TOKEN`

A Linear Personal API Key used to authenticate the Linear MCP server.

**How to create:**

1. Go to [linear.app → Settings → API → Personal API keys](https://linear.app/settings/api)
2. Click **Create key**, give it a label (e.g., `coworker-bot`)
3. Copy the generated key
4. Add it to Crafting Sandbox as secret name `linear-pat`

---

### `linear-webhook-secret`

**Used as:** `LINEAR_WEBHOOK_SECRET`

A shared secret used to verify that incoming webhook payloads are genuinely from Linear.

**How to create:**

1. Go to [linear.app → Settings → API → Webhooks](https://linear.app/settings/api)
2. Click **Create webhook**
3. Set the **URL** to your sandbox's webhook endpoint (e.g. `https://<sandbox-id>.sandbox.crafting.app/`)
4. Under **Secret**, generate or enter a random secret string (e.g. use `openssl rand -hex 32`)
5. Select the events you want (e.g. `Issue` created/updated)
6. Save and copy the secret value
7. Add it to Crafting Sandbox as secret name `linear-webhook-secret`

---

### `slack-bot-token` / `slack_token`

**Used as:** `SLACK_BOT_TOKEN`, `SLACK_MCP_XOXB_TOKEN`

A Slack Bot User OAuth Token (`xoxb-...`) used by both the webhook handler and the Slack MCP server.

**How to create:**

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From scratch**
2. Choose a name (e.g., `coworker-bot`) and select your workspace
3. Under **OAuth & Permissions → Scopes → Bot Token Scopes**, add:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `im:read`
   - `im:write`
   - `users:read`
4. Click **Install to Workspace** and authorize
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
6. Add it to Crafting Sandbox as secret name `slack-bot-token`

> Note: Some templates use `slack_token` (underscore). Adjust the secret name to match the template you are using.

---

### `slack-signing-secret`

**Used as:** `SLACK_SIGNING_SECRET`

Used by the webhook handler to verify that incoming requests are from Slack.

**How to create:**

1. In your Slack app settings ([api.slack.com/apps](https://api.slack.com/apps)), select your app
2. Go to **Basic Information → App Credentials**
3. Copy the **Signing Secret**
4. Add it to Crafting Sandbox as secret name `slack-signing-secret`
