# Event Triggering Scenarios

When an event passes all filters it reaches the command executor. Every filter layer below must pass — they are applied in order.

## Shared: Deduplication (all providers)

After provider-level filtering, `Watcher.isDuplicate()` checks the last comment/message on the resource. If the last comment was posted by the bot, the event is skipped. This prevents re-processing when no new human action has occurred since the bot last responded.

---

## GitHub

### Webhook

Accepted event types (default, overridable via `eventFilter`): `issues`, `pull_request`, `issue_comment`.

| Event type      | Default skipped actions                                                                                              | Bot involvement required           | Also skip if              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------- |
| `issues`        | _(none)_                                                                                                             | Bot **assigned** to issue          | Issue is closed           |
| `pull_request`  | `opened` `synchronize` `edited` `labeled` `unlabeled` `assigned` `unassigned` `locked` `unlocked` `review_requested` | Bot **assigned** to PR             | PR is closed/merged       |
| `issue_comment` | _(none)_                                                                                                             | Bot **@mentioned** in comment body | Parent issue/PR is closed |

Notes:

- `issue_comment` events on a PR normalize to type `pull_request` (not `issue`)
- Comments on closed resources are **always** skipped — the comment action is always `created`/`edited`/`deleted`, never `reopened`, so the "unless being reopened" escape used for other event types never applies here
- `review_requested` is skipped by default — requesting a review from the bot account does **not** trigger it

### Polling

Polls issues and PRs (updated since last poll) across configured repositories.

- **Issues:** bot must be assigned; skip if closed
- **PRs:** bot must be assigned; skip if closed; skip if updated only by commits (no recent human comments)
- Comments are **not polled** — GitHub polling only covers issues and PRs

### Known gaps / design concerns

- **`issue_comment` deleted action is not filtered**: if someone @mentions the bot in a comment and then deletes it, the delete webhook passes all filters and triggers the agent
- **Re-trigger risk on assignment**: if the agent assigns itself to an issue during a session (via GitHub MCP), the resulting `assigned` webhook fires and passes all filters; deduplication is the only guard — if the bot hasn't commented yet, a double-trigger is possible
- **No `review_requested` trigger**: PRs can only trigger the bot via assignment or comments, not via review requests

---

## GitLab

### Webhook

Accepted event types (default, overridable via `eventFilter`): `issue`, `merge_request`, `note`.

| Event type       | Default skipped actions | Bot involvement required        | Also skip if              |
| ---------------- | ----------------------- | ------------------------------- | ------------------------- |
| `issue`          | `open`                  | Bot **assigned** to issue       | Issue is closed           |
| `merge_request`  | `open` `update`         | Bot **assigned** to MR          | MR is closed/merged       |
| `note` (comment) | _(none)_                | Bot **@mentioned** in note body | Parent issue/MR is closed |

### Polling

Polls issues and MRs (updated since last poll) across configured projects.

- **Issues:** bot must be assigned; skip if closed
- **MRs:** bot must be assigned; skip if closed; skip if updated only by commits (no recent human notes)
- Notes (comments) are **not polled** — GitLab polling only covers issues and MRs

---

## Linear

### Webhook

Accepted event types (default, overridable via `eventFilter`): `Issue`, `Comment`.

| Event type | Default skipped states                                      | Bot involvement required           |
| ---------- | ----------------------------------------------------------- | ---------------------------------- |
| `Issue`    | `done` `cancelled` `canceled`                               | Bot **assigned** to issue          |
| `Comment`  | `done` `cancelled` `canceled` _(checks parent issue state)_ | Bot **@mentioned** in comment body |

### Polling

Polls issues (updated since last poll), optionally filtered to configured teams.

- Bot must be assigned; skip if state is `done`, `cancelled`, or `canceled`
- **Comments are not polled** — if a webhook for a comment @mention is missed (e.g., sandbox was down), there is no polling fallback; the event is permanently lost

### Known gaps / design concerns

- **No polling fallback for comment @mentions**: this is the most significant gap — a missed comment webhook cannot be recovered by polling

---

## Slack

### Webhook

- Only processes `app_mention` events by default (configurable via `eventFilter`)
- Bot involvement is implicit — `app_mention` means the bot was @mentioned
- No assignment check, no state/closed check (messages have no concept of closed)

### Known gaps / design concerns

- **No guard against bot-to-bot mentions**: if another bot @mentions this bot, it passes all filters; deduplication is the only protection if it happens within the same thread

---

## Filter Order Summary

For every incoming event, filters are applied in this sequence:

1. **Webhook signature / token** — reject if invalid
2. **Event type in `eventFilter`** — reject if event type not configured
3. **Action / state allowlist & denylist** — reject if action/state not permitted
4. **Bot involvement** — reject if bot not assigned (issues/PRs/MRs) or not @mentioned (comments/notes/Slack)
5. **Resource state** — reject if closed/done/cancelled (note: for `issue_comment` this is unconditional — comments on closed resources are always skipped)
6. **Polled PRs/MRs only** — reject if no recent human interaction (commit-only updates)
7. **Deduplication** — reject if bot's last comment on the resource is still from the bot
