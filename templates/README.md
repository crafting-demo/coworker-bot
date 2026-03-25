# Sandbox Template

This folder contains Crafting Sandbox templates for the coworker-bot agent. Each template references secrets using the `${secret:<name>}` syntax — these must be configured in your Crafting Sandbox before the sandbox will start successfully.

## How Secrets Work in Crafting Sandbox

Secrets are injected as environment variables at runtime. You configure them once in the Crafting Sandbox UI and reference them in templates as `${secret:<secret-name>}`.

To add a secret:

1. Open your Crafting Sandbox dashboard
2. Navigate to **Settings → Secrets**
3. Click **Add Secret**, enter the name and value, and save

The secret name must exactly match what is referenced in the template (e.g., `github-webhook-secret`, not `github_webhook_secret`).

---

## Secrets Reference

### GitHub App Installation

GitHub authentication uses the **GitHub App installation token** — no personal access token secret is needed.

**How to connect:**

1. Open the Crafting Web Console → **Connect → GitHub**
2. Connect your GitHub App and grant it access to the org repos you want the agent to use
3. The installation token is automatically injected by the mcp-proxy container into every GitHub MCP request

**Required env var:** `GITHUB_ORG` — the name of the org where the GitHub App is installed.

**Required repository permissions on the GitHub App:**

- Contents: Read and write
- Issues: Read and write
- Pull requests: Read and write

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
   - `users:read.email`
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

---

### `jira-api-token`

**Used as:** `JIRA_API_TOKEN`

Used to authenticate the Jira provider for polling issues and posting comments. The token type and the corresponding `watcher.yaml` `auth` block depend on whether you are using **Jira Cloud** or **Jira Server / Data Center**, and whether the token belongs to a **personal account** or a dedicated **service account**.

---

#### Jira Cloud — API Token

Jira Cloud does not support password authentication for the REST API. The auth method depends on the account type:

- **Personal account** — API token + email address via HTTP Basic auth (`auth.type: basic`)
- **Service account** — scoped API token via Bearer auth (`auth.type: token`) with a different `baseUrl`

**Personal account**

Use this for local development or personal projects where the bot acts on your behalf.

1. Sign in to [Atlassian](https://id.atlassian.com) as yourself
2. Go to **Account Settings → Security → [API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)**
3. Click **Create API token**, enter a label (e.g., `coworker-bot`), and click **Create**
4. Copy the token immediately — it is shown only once
5. Add it to Crafting Sandbox as secret name `jira-api-token`

`watcher.yaml` auth block:

```yaml
auth:
  type: basic
  username: you@example.com # your Atlassian account email
  tokenEnv: JIRA_API_TOKEN
```

**Service account (recommended for production)**

A service account is a dedicated Atlassian user that acts as the bot identity. Using one keeps bot activity separate from personal accounts and avoids disruption if team members leave.

Jira Cloud service accounts authenticate with a **scoped OAuth API token (Bearer)**, not Basic auth, and the REST API is accessed through the Atlassian API gateway using your Cloud ID rather than your regular Jira domain.

1. Create a new Atlassian account with a shared mailbox or alias (e.g., `coworker-bot@yourcompany.com`). If your organisation uses SSO, ask your Jira admin to create a **managed account** for the bot.
2. In Jira, add the service account as a member of each project it needs to access, with at minimum the **Service Desk Agent** or **Developer** role (enough to read issues and post comments).
3. Sign in to [Atlassian](https://id.atlassian.com) **as the service account** (use a private browser window or a separate browser profile).
4. Go to **Account Settings → Security → [API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)**
5. Click **Create API token**, enter a label (e.g., `coworker-bot-production`), and click **Create**
6. Copy the token immediately — it is shown only once
7. Add it to Crafting Sandbox as secret name `jira-api-token`

Find your Cloud ID (needed for `baseUrl`):

```bash
curl https://yourcompany.atlassian.net/_edge/tenant_info
# returns: {"cloudId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", ...}
```

`watcher.yaml` auth and options blocks:

```yaml
auth:
  type: token # Bearer token — no email field
  tokenEnv: JIRA_API_TOKEN

options:
  baseUrl: https://api.atlassian.com/ex/jira/<cloudId> # NOT yourcompany.atlassian.net
  botUsername: 'Coworker Bot' # Required — auto-detection does not work for service accounts
```

> **Note:** `botUsername` must be set explicitly for service accounts. Auto-detection via `/rest/api/3/myself` does not return a usable display name for scoped service account tokens. The value must match the Jira display name of the bot account exactly (case-insensitive).

---

#### Jira Server / Data Center — Personal Access Token

Jira Server and Data Center use **Personal Access Tokens (PAT)** for REST API authentication. A PAT is passed as a `Bearer` token — no email address is required (`auth.type: token`).

**Personal account**

1. Sign in to your Jira Server / DC instance as yourself
2. Click your avatar (top-right) → **Profile → Personal Access Tokens**
3. Click **Create token**, enter a name and an optional expiry date, then click **Create**
4. Copy the token immediately — it is shown only once
5. Add it to Crafting Sandbox as secret name `jira-api-token`

`watcher.yaml` auth block:

```yaml
auth:
  type: token
  tokenEnv: JIRA_API_TOKEN
```

**Service account (recommended for production)**

1. Ask your Jira admin to create a dedicated local user (e.g., `coworker-bot`) in **Jira → User Management**. The account does not need administrator rights — grant it the **Developer** or **Service Desk Agent** role in each target project.
2. Sign in to Jira **as the service account**.
3. Click the avatar → **Profile → Personal Access Tokens**
4. Click **Create token**, enter a name (e.g., `coworker-bot-production`) and an optional expiry, then click **Create**
5. Copy the token immediately — it is shown only once
6. Add it to Crafting Sandbox as secret name `jira-api-token`

`watcher.yaml` auth block:

```yaml
auth:
  type: token
  tokenEnv: JIRA_API_TOKEN
```

> **Note:** Jira Server / DC PATs are tied to the user who created them. If the account is disabled or the token expires, the bot will stop authenticating. Set a calendar reminder to rotate the token before expiry, or leave the expiry blank for a non-expiring token (check your organisation's security policy).

---

### `jira-webhook-secret`

**Used as:** `JIRA_WEBHOOK_SECRET`

Used to verify that incoming webhook payloads are genuinely from Jira. Jira Cloud signs payloads with an HMAC-SHA256 signature using this secret. See [Secure admin webhooks — Atlassian](https://developer.atlassian.com/cloud/jira/platform/webhooks/#secure-admin-webhooks) for details.

**How to get:**

1. Go to Jira → **Settings → System → WebHooks → Create a WebHook**
2. Jira generates a secret for you — copy it after creation
3. Add it to Crafting Sandbox as secret name `jira-webhook-secret`
