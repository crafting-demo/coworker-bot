# Flow: GitHub Issue to GitHub PR

This document shows how coworker-bot automatically turns GitHub issues into pull requests using **Crafting Sandbox**.

## Overview

**coworker-bot** runs as a pinned Crafting Sandbox that monitors your GitHub repositories. When you create a GitHub issue, it detects the event and creates a **Crafting Sandbox Coding Agent** from a matched template (based on repository or context) to implement the feature or fix, then creates a pull request with the changes - all automatically.

The Sandbox can be created from this example [template](../../templates/coworker-bot-github-issue-2-github-pr.example.yaml)

---

## Example Scenario

**You create a GitHub issue:**

```
Title: Add dark mode toggle to settings page

Users have been requesting a dark mode option. We should add a toggle
switch to the settings page that allows users to switch between light
and dark themes. The preference should be persisted in localStorage.

Acceptance criteria:
- Toggle switch in Settings component
- Persist theme preference
- Apply theme globally
```

## What Happens Next

### 1. **coworker-bot detects the issue** (within seconds)

The coworker-bot pinned Crafting Sandbox receives the GitHub webhook and validates it's a new issue that needs work.

---

### 2. **Bot posts a status comment**

On your issue, you'll see:

```
🤖 Crafting Sandbox Coding Agent is working on this issue
```

This lets you know the agent has started working, and prevents duplicate processing.

---

### 3. **Crafting Sandbox Coding Agent analyzes your request**

The agent receives a prompt with your issue details and gets to work:

- Reads and understands your requirements
- Explores your codebase to understand the architecture
- Plans the implementation approach

---

### 4. **Agent implements the feature**

The Crafting Sandbox Coding Agent:

- ✅ Finds the relevant files (`Settings.tsx`, `ThemeContext.tsx`)
- ✅ Adds a dark mode toggle component
- ✅ Implements localStorage persistence
- ✅ Applies theme globally via context
- ✅ Adds CSS styles for dark mode
- ✅ Writes comprehensive tests
- ✅ Creates clean, descriptive commits

---

### 5. **Agent creates a pull request**

The agent pushes a new branch and opens PR #43:

```
Title: Add dark mode toggle to settings page

## Changes
- Added theme toggle switch in Settings component
- Theme preference persisted in localStorage
- Dark theme applied globally via ThemeContext
- Added comprehensive tests

## Testing
- [x] Toggle switches between light and dark mode
- [x] Preference persists across page reloads
- [x] Theme applied globally
- [x] Tests passing

Closes #42
```

**Files changed:** 4 files, +120 lines

---

### 6. **You receive a status update**

Back on issue #42, the bot comments:

```
✅ **Task completed!**

Created pull request: https://github.com/acme/web-app/pull/43

The dark mode toggle has been implemented with:
- Theme toggle switch in Settings component
- Preference persistence via localStorage
- Global theme application
- Comprehensive test coverage

Please review the PR!
```

---

### 7. **You review and merge**

The PR is ready for your review. The Crafting Sandbox Coding Agent has done all the heavy lifting - you just need to review, approve, and merge!

---

## Visual Flow

```
┌──────────┐
│   You    │
│  Create  │  → Create Issue #42: "Add dark mode toggle"
│  Issue   │
└─────┬────┘
      │
      ↓
┌─────────────────────────────────────────────────┐
│  coworker-bot detects new issue (within seconds)  │
│  ✓ Validates webhook                            │
│  ✓ Checks it's not a duplicate                  │
└─────┬───────────────────────────────────────────┘
      │
      ↓
┌─────────────────────────────────────────────┐
│  Posts comment: "Agent is working on this"  │
└─────┬───────────────────────────────────────┘
      │
      ↓
┌───────────────────────────────────────────────────┐
│   Crafting Sandbox Coding Agent starts work       │
│   • Analyzes requirements                         │
│   • Explores codebase                             │
│   • Implements feature                            │
│   • Writes tests                                  │
│   • Creates commits                               │
└─────┬─────────────────────────────────────────────┘
      │
      ↓
┌──────────────────────────────────────────┐
│  Agent creates Pull Request #43          │
│  • Branch: feature/dark-mode-toggle      │
│  • 4 files changed                       │
│  • Tests included                        │
│  • Links back to issue #42               │
└─────┬────────────────────────────────────┘
      │
      ↓
┌─────────────────────────────────────────────┐
│  Posts update: "PR created! Please review"  │
└─────┬───────────────────────────────────────┘
      │
      ↓
┌──────────┐
│   You    │
│  Review  │  → Review PR, approve, and merge!
│    &     │
│  Merge   │
└──────────┘
```

⏱️ **Total time**: a few minutes from issue creation to PR ready for review

---

## Iterative Development

### You can keep adding requirements!

**You comment on the issue:**

```
@coworker-bot-bot Can you also add keyboard shortcut Ctrl+D to toggle dark mode?
```

**The Crafting Sandbox Coding Agent:**

1. Detects your new comment
2. Posts "Working on the update..."
3. Updates the existing PR with the keyboard shortcut
4. Replies: "Updated PR #43 with Ctrl+D keyboard shortcut"

### Deduplication protection

If the webhook is accidentally triggered multiple times, coworker-bot is smart enough to avoid duplicate work:

- ✅ Checks the last comment on the issue
- ✅ If it's from the bot, skips processing
- ✅ Only processes when there's new human input

## Configuration

This flow requires minimal configuration in your `config/watcher.yaml`:

```yaml
providers:
  github:
    enabled: true
    auth:
      type: token
      tokenEnv: GITHUB_PERSONAL_ACCESS_TOKEN
    options:
      webhookSecretEnv: GITHUB_WEBHOOK_SECRET
      repositories:
        - your-org/your-repo

commandExecutor:
  enabled: true
  command: 'cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task'
  promptTemplateFile: ./config/event-prompt.hbs
  useStdin: true
  followUp: true # Post result back to issue
```

## Architecture

**Pinned Sandbox + Template-based Agents:**

1. **coworker-bot** (pinned Crafting Sandbox - always running)
   - Monitors GitHub, Slack, Linear, etc. for events
   - Receives webhooks and manages polling
   - Handles deduplication and event routing

2. **Crafting Sandbox Coding Agent** (created from matched templates)
   - Created for each issue/task using templates matched by repository or context
   - Reads code, implements features, writes tests
   - Creates commits and pull requests
   - Reports results back

## Why This Works

- **Real-time**: Webhooks deliver issue events within seconds
- **Smart**: Deduplication prevents processing the same issue twice
- **Autonomous**: Crafting Sandbox Coding Agent has full access to read code, make changes, and create PRs
- **Transparent**: All activity is visible as comments on your issues
- **Scalable**: Multiple coding agents can work in parallel on different tasks
- **Flexible**: Works with GitHub, Linear, Slack, and more

## Quick Troubleshooting

| Problem              | Solution                                                   |
| -------------------- | ---------------------------------------------------------- |
| Bot doesn't respond  | Check webhook configuration and bot permissions            |
| Duplicate processing | Ensure deduplication is enabled with correct `botUsername` |
| No follow-up comment | Verify `followUp: true` and bot has write access           |

---

## Next Steps

- See [Slack Thread to PR Flow](./slack-thread-to-pr-flow.md) for Slack integration
- Review [GitHub Provider Setup](../../setup/providers/github.md) for configuration details
- Explore [Event Prompt Templates](../../config/event-prompt.hbs) for customization
