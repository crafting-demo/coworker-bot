# coworker-bot Setup Wizard

ACTION: Silently run `which cs` to verify the cs CLI is installed. If not found, tell the user: "You'll need the Crafting Sandbox CLI (`cs`) to continue. Install it from https://www.crafting.dev/ and come back when it's ready." Then STOP and wait.

Print this exactly, then wait for the user to reply:

---

**Welcome to coworker-bot setup!**

Which providers would you like to set up? *(enter numbers, e.g. "1" or "1, 4")*

1. **GitHub** — Monitor issues, PRs, and comments. Auto-creates PRs from issues. *(Recommended)*
2. **Linear** — Monitor Linear issues based on state changes
3. **Slack** — Respond to @mentions and create PRs from Slack threads

You can always add more later.

---

STOP: Wait for the user to reply with their selection.

USER: Enters one or more numbers

[Remember the selection — you'll need it for the rest of the wizard. Confirm back what was selected.]

---

## Provider Credentials

[Go through ONLY the sections below that match the user's selected providers. Skip the rest. Do them in this order: GitHub → Linear → Slack.]

---

### GitHub Credentials

GitHub authentication uses a **GitHub App installation token** — no personal access token or separate bot account is needed.

**Step 1 — Connect the GitHub App:**

ACTION: Open the Crafting Web Console for the user and guide them to **Connect → GitHub**.

Connect your GitHub App to the Crafting org and grant it access to the repos you want to monitor. The installation token is automatically injected by the sandbox — no secret needs to be created for authentication.

Note the **org name** where the app is installed — you'll need it as `GITHUB_ORG`.

Note the **bot username** for deduplication — optional, defaults to `coworker-bot`. It can be the GitHub App's bot username (e.g. `my-app[bot]`), or any arbitrary name you choose. Events where the last comment is from this name are skipped to prevent the bot from re-processing its own work.

STOP: Go connect the GitHub App in the Web Console. Let me know when it's done, and share the org name and the bot username you want to use.

USER: Confirms app is connected and provides org name + bot username

**Step 2 — Generate a webhook secret:**

Open a **separate terminal** and run:

```
echo "$(openssl rand -hex 32)" | cs secret create github-webhook-secret --shared -f -
```

After creating the secret, mark it as **Admin Only** and **Not Mountable** in the Web Console (Secrets → select secret → Edit).

STOP: Go create the webhook secret and mark it in the Web Console. Let me know when it's done.

USER: Confirms secret is stored

**Step 3 — Repositories:**

STOP: Which **repositories** should coworker-bot monitor? Format: `owner/repo`, comma-separated. Example: `myorg/frontend, myorg/backend`

(Or say "auto" — repositories are auto-detected from the installation token via `GET /installation/repositories`.)

USER: Provides repositories or "auto"

[Store the GitHub org name, bot username, repository list, and that GITHUB_WEBHOOK_SECRET was created — needed for template generation later.]

GitHub is all set!

---

### Linear Credentials

You'll need a **Linear API key** and a **webhook secret**.

**Step 1 — Create an API key:**

ACTION: Open that link for the user: https://linear.app/settings/api

On that page:
1. Under **Personal API keys**, click **"Create key"**
2. Label it `coworker-bot`
3. Click **"Create key"** and **copy it immediately** — it won't be shown again

**Step 2 — Create a webhook:**

On the same page, under **Webhooks**:
1. Click **"Create webhook"**
2. Set:
   - **Label:** `coworker-bot`
   - **Webhook URL:** leave blank for now (you'll fill it in after the sandbox is created)
   - **Resource types:** check **Issue** and **Comment**
3. Click **"Create webhook"**
4. **Copy the webhook secret** that Linear generates — it won't be shown again

**Step 3 — Store as Crafting secrets:**

Open a **separate terminal**:

```
echo "YOUR_API_KEY_HERE" | cs secret create linear-pat --shared -f -
echo "YOUR_WEBHOOK_SECRET_HERE" | cs secret create linear-webhook-secret --shared -f -
```

Mark both as **Admin Only** and **Not Mountable** in the Web Console.

STOP: Go create the API key and webhook, store them as secrets, and mark them in the Web Console. Let me know when it's done.

USER: Confirms secrets are stored

STOP: What's your **Linear bot display name**? (The display name of the Linear account the agent will use — for deduplication)

USER: Provides name

STOP: Which **teams** should coworker-bot monitor? Enter team keys like `ENG`, `PRODUCT` (found in Linear → Settings → Teams, or in issue IDs like "ENG-123"). Say "all" to monitor every team.

USER: Provides team keys or "all"

[Store all Linear configuration for later.]

Linear is all set!

---

### Slack Credentials

Slack setup requires creating a **Slack App**. This has a few more steps than the other providers.

**Step 1 — Create the Slack App:**

ACTION: Open the Slack app creation page for the user: https://api.slack.com/apps

1. Click **"Create New App" → "From scratch"**
2. Name it `Auto Coder Bot` (or your preference)
3. Select your workspace
4. Click **"Create App"**

**Step 2 — Add Bot Permissions:**
1. Go to **OAuth & Permissions**
2. Under **Bot Token Scopes**, add these scopes:
   - `app_mentions:read`
   - `chat:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `search:read`

**Step 3 — Enable Events (optional now, can configure after sandbox is created):**
1. Go to **Event Subscriptions**
2. Toggle **Enable Events** to On
3. Under **Subscribe to bot events**, add: `app_mention`
4. The Request URL will be your sandbox's webhook endpoint — we'll get that URL after creating the sandbox. You can skip this step for now and come back to set it up later.
5. Click **Save Changes**

**Step 4 — Install the App:**
1. Go to **Install App**
2. Click **"Install to Workspace"** → **"Allow"**
3. **Copy the "Bot User OAuth Token"** (starts with `xoxb-`)

**Step 5 — Get the Signing Secret:**
1. Go to **Basic Information**
2. Under "App Credentials", find **Signing Secret**
3. Click **"Show"** and copy it

**Step 6 — Store as Crafting secrets:**

Open a **separate terminal**:

```
echo "YOUR_BOT_TOKEN" | cs secret create slack-bot-token --shared -f -
echo "YOUR_SIGNING_SECRET" | cs secret create slack-signing-secret --shared -f -
```

Mark both as **Admin Only** and **Not Mountable** in the Web Console.

STOP: Go through those steps now. You should end up with the **Bot Token** (`xoxb-...`) and the **Signing Secret**, both stored as secrets. Let me know when it's done.

USER: Confirms secrets are stored

Slack is all set!

---

## Sandbox Template & Creation

All credentials are stored. Now let's create your Crafting Sandbox.

ACTION: Based on the providers the user selected, choose the best base template:

- **GitHub only** → `docs/examples/templates/coworker-bot-quick-start.yaml`
- **GitHub + Slack** (no Linear) → `docs/examples/templates/coworker-bot-slack-2-github-pr.example.yaml`
- **Any combination including Linear**, or **all providers** → `templates/coworker-bot-full.yaml`

Read the chosen template file. You will need to create a working copy with adjustments.

ACTION: Detect the coworker-bot repo's git remote URL by running `git remote get-url origin` in the coworker-bot directory. If the URL differs from what's in the template (the template defaults to `git@github.com:crafting-demo/coworker-bot.git`), you'll need to update it.

ACTION: Create a working copy of the template at `_local/setup-generated.yaml` (create the `_local/` directory if it doesn't exist):
1. Start from the chosen base template
2. Update the git checkout URL in `workspaces[0].checkouts[0].repo.git` to match the user's actual remote (or the original if they're using the default)
3. Fill in the required `env` values collected during the wizard:
   - `GITHUB_ORG` — org where the GitHub App is installed (GitHub)
   - `GITHUB_BOT_USERNAME` — GitHub App bot username, e.g. `my-app[bot]` (GitHub)
   - `GITHUB_REPOSITORIES` — comma-separated `owner/repo` list, or omit to auto-detect (GitHub)
   - `LINEAR_BOT_USERNAME` — Linear bot display name (Linear, if selected)
   - `LINEAR_TEAMS` — comma-separated team keys, or omit the line entirely if "all" (Linear, if selected)
4. Ensure the `env` secret references match what was created:
   - GitHub: `${secret:github-webhook-secret}`
   - Linear: `${secret:linear-pat}`, `${secret:linear-webhook-secret}`
   - Slack: `${secret:slack-bot-token}`, `${secret:slack-signing-secret}`
5. If providers were not selected, remove their corresponding `env` entries, `containers`, `endpoints`, and `customizations` from the template. Keep only what's needed.
6. Always keep: the `webhook` endpoint, the `dev` workspace with port 3000, and the `watcher` daemon.

ACTION: Validate the generated template YAML by running `/home/owner/yaml-linter/yaml-lint-go _local/setup-generated.yaml`. Fix any issues.

Tell the user which base template you used and what adjustments were made.

STOP: What would you like to name your **template**? (A reusable name, e.g., `coworker-bot` or `my-coworker-bot`)

USER: Provides template name

ACTION: Run `cs template create <template_name> ./_local/setup-generated.yaml`

[If it fails with "already exists", ask the user if they want to update it or choose a different name.]

STOP: What would you like to name your **sandbox**? (The running instance, e.g., `coworker-bot-prod` or `coworker-bot-dev`)

USER: Provides sandbox name

ACTION: Run `cs sandbox create <sandbox_name> -t <template_name>`

[If it fails, help troubleshoot. Common issues: template not found, quota exceeded, name already taken.]

ACTION: Run `cs sandbox pin <sandbox_name>`

**MUST pin the sandbox.** Without pinning, the sandbox suspends after inactivity and will miss webhook events. Events received while suspended are lost.

---

## Watcher Configuration

The template already embeds a working `watcher.yaml` via its `system.files` block — it auto-configures from the env vars filled in earlier (`GITHUB_BOT_USERNAME`, `GITHUB_REPOSITORIES`, etc.), so no further changes are needed for a standard setup.

If the user wants advanced settings (custom event filters, polling intervals, team restrictions), update the `content:` block inside `system.files` in `_local/setup-generated.yaml` before creating the template. The embedded watcher.yaml structure looks like this:

```yaml
server:
  host: 0.0.0.0
  port: 3000
commandExecutor:
  enabled: true
  command: "cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task"
  promptTemplateFile: ./config/event-prompt.hbs
  useStdin: true
  followUp: true
deduplication:
  enabled: true
  commentTemplate: "Agent is working on {id}"
providers:
  # Include ONLY the providers the user selected.
  #
  # GitHub:
  #   enabled: true
  #   pollingInterval: 60
  #   options:
  #     botUsername: <GITHUB_BOT_USERNAME — already set via env var, can omit>
  #     repositories:   <GITHUB_REPOSITORIES — already set via env var, can omit>
  #       - owner/repo
  #
  # Linear:
  #   enabled: true
  #   pollingInterval: 60
  #   options:
  #     botUsername: <LINEAR_BOT_USERNAME>
  #     teams:          <omit to monitor all teams>
  #       - ENG
  #
  # Slack:
  #   enabled: true
  #   pollingInterval: 300
  #   options:
  #     pollingEnabled: true
```

**Important:** The template injects this file with `overwrite: true`, so it is rewritten on every sandbox start. Always edit the watcher.yaml content inside the template (`_local/setup-generated.yaml`), not the file on disk inside the sandbox.

Show the user the embedded watcher.yaml content and briefly explain the key settings. Ask if they want to adjust anything before the template is finalized.

STOP: Does the watcher configuration look right, or would you like to adjust any settings (event filters, polling intervals, etc.)?

USER: Confirms or requests changes

[Apply any requested changes to the `content:` block in `_local/setup-generated.yaml`, then re-validate and re-run `cs template create` with the updated file.]

---

## Authorize MCP Servers

One more required step — authorizing the MCP servers so Crafting Coding Agent sessions can use provider tools (read issues, create PRs, etc.).

1. Open the **Crafting Web Console**
2. Navigate to **Connect → LLM**
3. Click the **Discovery** tab
4. Input your sandbox name and click **Authorize**

Without this step, the agent cannot read issues or create PRs.

STOP: Go complete the MCP authorization step now. Let me know when it's done.

USER: Confirms authorization is complete

---

## Setup Complete!

You're all set! Here's what we configured:

ACTION: Print a summary:
- **Providers:** list what was set up
- **Monitoring:** repositories, teams, or channels being watched
- **Secrets stored:** list the secret names (not values)
- **Template:** the template name
- **Sandbox:** the sandbox name (pinned)

Then provide these next steps:

**Webhook Setup:**
Your sandbox has a public webhook endpoint. Find the URL in the Web Console: sandbox → **Endpoints** → **webhook**.

Configure webhooks in your provider settings:
- GitHub: Repository → Settings → Webhooks → add `https://<your-url>/webhook/github`
- Linear: Settings → API → Webhooks → update the webhook URL to `https://<your-url>/webhook/linear`
- Slack: App → Event Subscriptions → set Request URL to `https://<your-url>/webhook/slack`

Without webhooks, coworker-bot will use polling mode (checking every 60s for GitHub/Linear, every 5min for Slack).

**Verify:**
```
cs logs --workspace <sandbox-name>/dev --follow watcher
```
Look for: `Watcher started successfully` and `Initialized provider: <name>`.

**Testing:**
Create a test issue in one of your monitored repositories. Within ~30 seconds the bot should comment: *"Agent is working on #\<number\>"* and a Crafting Coding Agent session will start.

**Useful commands:**
- `cs sandbox list` — view your sandboxes and endpoints
- `cs logs --workspace <name>/dev --follow watcher` — view watcher logs
- `cs secret list` — view stored secrets

**Troubleshooting:**
- See `docs/setup/github.md`, `docs/setup/linear.md`, `docs/setup/slack.md` for provider-specific help
- See `docs/overview.md` for architecture details

STOP: Any questions, or would you like to test the setup?

USER: Questions or ready to test

[If they want to test, suggest creating a GitHub issue in a monitored repo and checking the sandbox logs. Help them verify events are being received.]

---

## Important Notes for Claude

- **Track all user input** — every piece of information collected (usernames, repos, teams) is needed for template generation. Don't lose it between sections.
- **Never handle secrets directly** — always instruct the user to run `cs secret create` in a separate terminal. Never ask for, accept, or run commands containing tokens/secrets. If a user pastes one accidentally, don't echo it.
- **Secret names must match the template** — the `cs secret create` name must match the `${secret:name}` in the sandbox template YAML. The wizard standardizes on hyphen naming: `github-webhook-secret`, `linear-pat`, `linear-webhook-secret`, `slack-bot-token`, `slack-signing-secret`. GitHub no longer uses `github-pat` — authentication is via the GitHub App installation.
- **Template YAML validation** — always validate generated templates with `/home/owner/yaml-linter/yaml-lint-go` before creating them.
- **Git remote detection** — use `git remote get-url origin` to detect the user's repo URL. Fall back to asking if the command fails.
- **Don't overwhelm** — only show provider sections relevant to the user's selection. Skip everything else.
- **Error recovery** — if `cs` commands fail:
  - "already exists" → offer to update or pick a new name
  - auth errors → suggest `cs auth login`
  - YAML errors → fix and retry
  - secret exists → offer `cs secret update` or `cs secret delete` + recreate
- **Adapt pacing** — technical users will move fast. Less technical users may need more context. Match their speed.

## Success Criteria

The setup is complete when:
- [ ] cs CLI is available
- [ ] Provider credentials stored as sandbox secrets (with correct hyphen-named keys)
- [ ] Sandbox template created and validated
- [ ] Sandbox created from template
- [ ] Sandbox is pinned (`cs sandbox pin`)
- [ ] MCP servers authorized (Web Console → Connect → LLM → Discovery → Authorize)
- [ ] User knows about webhook setup and testing
