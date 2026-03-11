# Flow: Slack Thread to GitHub PR

This document shows how coworker-bot automatically turns Slack conversations into GitHub pull requests using **Crafting Sandbox**.

## Overview

**coworker-bot** runs as a pinned Crafting Sandbox that monitors your Slack workspace. When you @mention the bot with a bug report or feature request, it creates a **Crafting Sandbox Coding Agent** from a matched template (based on repository or context) to investigate, implement the fix, and create a pull request - all while keeping your team updated in the Slack thread.

The Sandbox can be created from this example [template](../templates/coworker-bot-slack-2-github-pr.example.yaml)

---

## Example Scenario

**In your #engineering Slack channel:**

```
alice [9:15 AM]
Hey team, I found a bug in the user profile page. When users have special
characters in their names (like "O'Brien"), the page crashes with a SQL error.

We need to fix this ASAP as it's affecting multiple users.

Error message:
SQL syntax error: You have an error in your SQL syntax near 'Brien'

@coworker-bot can you investigate and fix this?
```

## What Happens Next

### 1. **coworker-bot detects your @mention** (instantly)

The coworker-bot pinned Crafting Sandbox receives the Slack webhook and validates you've mentioned the bot.

---

### 2. **Bot replies in the thread**

```
coworker-bot BOT [9:15 AM]
🤖 Crafting Sandbox Coding Agent is investigating this issue
```

---

### 3. **Crafting Sandbox Coding Agent analyzes the bug**

The agent receives the full thread context and gets to work:

- Reads the error message and identifies it as a SQL injection vulnerability
- Determines this is in the backend repository
- Plans the investigation and fix

---

### 4. **Agent investigates and fixes the bug**

The Crafting Sandbox Coding Agent:

- ✅ Searches the codebase for vulnerable SQL queries
- ✅ Finds the issue in `src/api/users/profile.ts`
- ✅ Identifies unsafe string interpolation: `SELECT * FROM users WHERE name = '${name}'`
- ✅ Replaces with parameterized queries
- ✅ Adds input validation
- ✅ Writes comprehensive tests for special characters
- ✅ Creates clear, descriptive commits

---

### 5. **Agent creates a pull request**

The agent pushes the fix and creates PR #156:

```
Title: Fix SQL injection vulnerability in user profile

## Summary
Fixes critical SQL injection vulnerability reported by @alice in Slack.

## Changes
- Replace string interpolation with parameterized queries
- Add input validation for name parameter
- Add comprehensive test coverage for special characters

## Security Impact
This fixes a SQL injection vulnerability that could have allowed:
- Unauthorized data access
- Data modification
- Database compromise

## References
- Slack discussion: https://acme.slack.com/archives/C01ABC123/p1709028900123456
- Reported by: @alice
```

**Files changed:** 2 files, +45 lines

---

### 6. **Team gets updated in Slack**

```
coworker-bot BOT [9:17 AM]
✅ **Issue fixed!**

I found and fixed a SQL injection vulnerability in the user profile query.

**Problem:**
The code was using string interpolation (`${name}`) in SQL queries, which
doesn't escape special characters like apostrophes. This caused both the
crash you saw AND a critical security vulnerability.

**Solution:**
- Replaced with parameterized queries for proper escaping
- Added input validation
- Added comprehensive tests

**Pull Request:**
https://github.com/acme/backend/pull/156

The fix is ready for review. This was a critical security issue that could
have allowed SQL injection attacks.
```

---

### 7. **Team continues collaborating**

```
alice [9:18 AM]
Wow, that was fast! And good catch on the security vulnerability - I didn't
even realize it was an injection risk. Thanks @coworker-bot!

bob [9:20 AM]
@coworker-bot can you also add similar checks to the other user search endpoints?
We probably have the same issue there.
```

The bot detects Bob's new @mention and starts another investigation!

---

## Visual Flow

```
┌──────────┐
│   Team   │
│  Member  │  → @mentions bot in Slack: "Found a bug with O'Brien names"
└─────┬────┘
      │
      ↓
┌──────────────────────────────────────────────────┐
│  coworker-bot detects @mention (instantly)         │
│  ✓ Validates webhook from Slack                  │
│  ✓ Retrieves full thread context                 │
│  ✓ Checks it's not a duplicate                   │
└─────┬────────────────────────────────────────────┘
      │
      ↓
┌──────────────────────────────────────────────────┐
│  Bot posts to Slack thread:                      │
│  "Crafting Sandbox Coding Agent is investigating"│
└─────┬────────────────────────────────────────────┘
      │
      ↓
┌────────────────────────────────────────────────────┐
│   Crafting Sandbox Coding Agent investigates       │
│   • Analyzes error message                         │
│   • Searches codebase for SQL queries              │
│   • Identifies SQL injection vulnerability         │
│   • Fixes with parameterized queries               │
│   • Adds input validation & tests                  │
│   • Creates commits                                │
└─────┬──────────────────────────────────────────────┘
      │
      ↓
┌───────────────────────────────────────────┐
│  Agent creates Pull Request #156          │
│  • Branch: fix/sql-injection-user-profile │
│  • 2 files changed                        │
│  • Security vulnerability fixed           │
│  • Links back to Slack thread             │
└─────┬─────────────────────────────────────┘
      │
      ↓
┌────────────────────────────────────────────────┐
│  Bot posts update to Slack:                    │
│  "Issue fixed! PR #156 created. This was a     │
│   critical SQL injection vulnerability."       │
└─────┬──────────────────────────────────────────┘
      │
      ↓
┌──────────┐
│   Team   │
│ Continues│  → Discussion continues in thread, PR gets reviewed
│   Work   │
└──────────┘
```

⏱️ **Total time**: a few minutes from @mention to PR + security analysis

---

## Architecture

**Pinned Sandbox + Template-based Agents:**

1. **coworker-bot** (pinned Crafting Sandbox - always running)
   - Monitors Slack, GitHub, Linear, etc. for events
   - Receives webhooks from Slack when bot is @mentioned
   - Retrieves full thread context for better understanding
   - Handles deduplication and event routing

2. **Crafting Sandbox Coding Agent** (created from matched templates)
   - Created for each @mention/request using templates matched by repository or context
   - Analyzes the conversation and determines action
   - Investigates bugs, implements features, writes tests
   - Creates commits and pull requests
   - Reports results back to Slack thread

---

## Configuration

This flow requires Slack-specific configuration:

```yaml
providers:
  slack:
    enabled: true
    auth:
      tokenEnv: SLACK_BOT_TOKEN
    options:
      signingSecretEnv: SLACK_SIGNING_SECRET

commandExecutor:
  enabled: true
  command: 'cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task'
  prompts:
    slack: ./config/event-prompt-slack.hbs # Slack-specific template with thread history
  useStdin: true # Pipe rendered prompt to command's stdin
  followUp: true # Post results back to Slack thread
```

**Required Slack App Scopes:**

- `app_mentions:read` - Detect @mentions
- `chat:write` - Post messages
- `channels:history` - Read public channel thread history (for context + deduplication)
- `groups:history` - Read private channel thread history
- `im:history` - Read direct message thread history
- `search:read` - Search for missed mentions (polling mode)

**Event Subscription:**

- Subscribe to `app_mention` events
- Set webhook URL: `https://webhook--<sandbox-name>-<your-org>.sandboxes.site/webhook/slack`

## Advanced Use Cases

### Multi-Repository Context

```
@coworker-bot I'm seeing auth errors in the mobile app. The backend shows
"Invalid token format" errors. Can you check both repos?
```

→ Agent searches both repositories, creates PRs for each, reports back

### Iterative Development

```
alice: @coworker-bot add a feature flag for the new dashboard
Bot: ✅ Created PR #200
alice: @coworker-bot also add it to mobile config
Bot: ✅ Updated PR #200 with mobile changes
bob: @coworker-bot add documentation
Bot: ✅ Updated PR #200 with docs
```

→ Single PR evolves through conversation

### Code Review Requests

```
@coworker-bot review PR #150 and let me know if you spot issues
```

→ Agent analyzes the PR and posts findings in thread + PR comments

---

## Why Slack Integration Works Well

- **Always monitoring**: coworker-bot pinned Crafting Sandbox runs 24/7, watching for @mentions
- **Natural conversation**: Discuss bugs/features in your existing channels
- **Full context**: Crafting Sandbox Coding Agent sees the entire thread conversation
- **Team collaboration**: Multiple people can participate and @mention the bot
- **Real-time updates**: Results posted directly to your thread
- **Smart repository detection**: Agent figures out which repo(s) to work in
- **Parallel execution**: Multiple agents can work on different tasks simultaneously

---

## Quick Troubleshooting

| Problem                    | Solution                                           |
| -------------------------- | -------------------------------------------------- |
| Bot doesn't respond        | Check Slack app has `app_mention` event subscribed |
| Can't read thread history  | Add `channels:history` and `groups:history` scopes |
| Signature validation fails | Verify `SLACK_SIGNING_SECRET` matches Slack app    |
| Bot not in channel         | Invite bot to channel or make it public            |

---

## Next Steps

- See [GitHub Issue to PR Flow](./github-issue-to-pr-flow.md) for direct GitHub integration
- Review [Slack Provider Setup](../../setup/providers/slack.md) for detailed configuration
- Learn about [Slack App Setup](https://api.slack.com/start/building) for creating your bot
