# Buildkite Provider Setup

Give the Crafting Coding Agent tools to read Buildkite pipelines, builds, and logs so it can diagnose CI failures and act on them.

**Note:** Buildkite is **MCP-only** — the watcher does not listen for Buildkite webhook events and does not poll Buildkite. The agent gains Buildkite access as a tool set, typically invoked when another provider event (e.g. a GitHub check failure or a Linear issue) involves a CI problem.

**Prerequisites:** Crafting CLI (`cs`) installed and authenticated as an org admin. A Buildkite account with access to the pipelines you want the agent to read.

---

## Step 1 — Create a Buildkite API Token

1. Sign in to Buildkite
2. Go to **Personal Settings → API Access Tokens → New API Access Token**
3. Set:
   - **Description:** `coworker-bot`
   - **Scopes:** Minimum Access + all read-only access (add `write_builds` if you want the agent to trigger builds)
4. Click **Create New API Access Token** and **copy the token immediately** — it will not be shown again

---

## Step 2 — Create the Crafting Secret

Store the token as a Crafting secret:

```bash
echo "YOUR_BUILDKITE_API_TOKEN" | cs secret create buildkite-api-token --shared -f -
```

After creating the secret, mark it as **Admin Only** and **Not Mountable** in the Web Console (Secrets → select secret → Edit).

The token is picked up automatically by the `buildkite-mcp` container via the top-level `BUILDKITE_API_TOKEN` env var in the sandbox template.

---

## MCP Tools

The sandbox runs the [official Buildkite MCP server](https://github.com/buildkite/buildkite-mcp-server) as a sidecar container in HTTP mode. Once the sandbox is created and MCP is authorized (Web Console → **Connect → LLM** → **Sandboxes Authorized to Expose MCP Servers**), the agent can use Buildkite tools in any coding session.

Available tools include (depending on token scopes):

- List and inspect pipelines and builds
- Read build steps, job logs, and test results
- Trigger new builds (`write_builds` scope required)

---

## Troubleshooting

**Agent cannot use Buildkite tools**

- Verify the secret exists: `cs secret list | grep buildkite`
- Verify the template references `${secret:buildkite-api-token}` in the `env:` block
- Confirm MCP is authorized: Web Console → **Connect → LLM** → **Sandboxes Authorized to Expose MCP Servers** — the sandbox must be listed there
- Confirm the sandbox is pinned (`cs sandbox pin coworker-bot`) — MCP servers are unavailable when the sandbox is suspended

**Authentication errors from the Buildkite MCP server**

- Verify the API token has not expired or been revoked: Buildkite → Personal Settings → API Access Tokens
- Verify the token has the required scopes for the operations the agent is attempting
- Check container logs: `cs logs --workspace coworker-bot/buildkite-mcp`

**Agent can read builds but cannot trigger them**

- The `write_builds` scope is not included in the API token. Re-create the token with `write_builds` and update the secret:
  ```bash
  echo "NEW_TOKEN" | cs secret update buildkite-api-token -f -
  cs sandbox restart coworker-bot
  ```
