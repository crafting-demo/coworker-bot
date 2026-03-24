# GitHub Quick Start

Get coworker-bot running with GitHub in ~10 minutes.

## Prerequisites

- [Node.js](https://nodejs.org/) v20+ (LTS recommended)
- [pnpm](https://pnpm.io/installation) — install via `npm install -g pnpm` or the [standalone installer](https://pnpm.io/installation)
- Crafting CLI (`cs`) installed and authenticated as an org admin

---

## 1. Create and connect a GitHub App

### 1a. Create a GitHub App

Create a new GitHub App in your GitHub organization (**Settings → Developer settings → GitHub Apps → New GitHub App**) and configure:

**Permissions (Repository):**

- Contents: Read and write
- Issues: Read and write
- Pull requests: Read and write

**URLs** (replace `<name>` with your Crafting sandbox system hostname):

| Field        | Value                                                       |
| ------------ | ----------------------------------------------------------- |
| Callback URL | `https://<name>.sandboxes.site/integration/github/callback` |
| Webhook URL  | `https://<name>.sandboxes.site/integration/github/events`   |

### 1b. Contact Crafting support to enable GitHub

The GitHub App feature must be enabled for your sandbox system before you can use it. Contact the Crafting support team to enable it.

### 1c. Connect the GitHub App in Crafting

In the **Crafting Web Console → Connect → GitHub**: connect to your GitHub App and the org repos you want the agent to access.

Note two values you will need below:

- The **org name** where the app is installed → `GITHUB_ORG`
- The **bot username** of the GitHub App → `GITHUB_BOT_USERNAME`. GitHub automatically appends `[bot]` to every App's login, so if your app is named `my-app`, the bot username is `my-app[bot]`.

---

## 2. Create secrets in Crafting

Generate a webhook secret and store it:

```bash
echo "$(openssl rand -hex 32)" | cs secret create github-webhook-secret --shared -f -
```

After creating the secret, mark it as **Admin Only** and **Not Mountable** in the Web Console (Secrets → select secret → Edit).

---

## 3. Configure template and start a Sandbox

Download the template into a local folder (gitignored, safe for customizations):

```bash
mkdir -p _local
curl -o _local/coworker-bot-quick-start.yaml \
  https://raw.githubusercontent.com/crafting-demo/coworker-bot/refs/heads/master/docs/examples/templates/coworker-bot-quick-start.yaml
```

Open `_local/coworker-bot-quick-start.yaml` and set:

- `GITHUB_ORG` — the org name from Step 1
- `GITHUB_BOT_USERNAME` — **required for deduplication**; the GitHub App's bot username. GitHub automatically appends `[bot]` to every App's login (e.g. `my-app[bot]`). Installation tokens cannot auto-detect this — it must be set explicitly. Find the exact value by checking a comment already posted by the app in GitHub.

`GITHUB_REPOSITORIES` is **auto-detected from the installation token** (via `GET /installation/repositories`) and can be left commented out. Uncomment and set it only if you want to override the auto-detected list.

Create the template and sandbox from the local file:

```bash
cs template create coworker-bot ./_local/coworker-bot-quick-start.yaml
cs sandbox create coworker-bot -t coworker-bot
cs sandbox pin coworker-bot
```

> **MUST pin the sandbox.** Without pinning, the sandbox suspends after inactivity and misses webhook events. Events received while suspended are lost.

---

## 4. Configure the GitHub webhook

Find your webhook URL: Web Console → Sandbox → Endpoints → "webhook"

In each monitored repository go to **Settings → Webhooks → Add webhook**:

| Field        | Value                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| Payload URL  | `https://webhook--coworker-bot-<your-org>.sandboxes.site/webhook/github` |
| Content type | `application/json` ← **required**                                        |
| Secret       | webhook secret from Step 2                                               |
| Events       | Issues, Pull requests, Issue comments                                    |

---

## 5. Authorize MCP servers

Web Console → **Connect → LLM** → under **Sandboxes Authorized to Expose MCP Servers**, click **Add**, input the sandbox name `coworker-bot`, and confirm.

Without this step the agent cannot read issues or create PRs.

For more details, please refer to this [doc](https://docs.sandboxes.cloud/features/llm-config.html).

---

## 6. Verify

```bash
cs logs --workspace coworker-bot/dev --follow watcher
```

Create a test issue in one of your monitored repos. Within ~30 seconds the bot should comment: _"Agent is working on #\<number\>"_ and a Crafting Coding Agent session will start.

---

For security hardening, token rotation, event filtering, and multi-provider setup, see **[docs/setup/README.md](setup/README.md)**.
