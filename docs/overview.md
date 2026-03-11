# coworker-bot Overview

coworker-bot is the central piece of the automated coding flow. It acts as an event listener that chains together the entire pipeline by integrating with the Crafting Sandbox coding agent and runtime.

## What It Does

coworker-bot listens for events from developer platforms (GitHub, Linear, Slack), filters and preprocesses them, constructs a task prompt, and starts a Crafting Sandbox Coding Agent session via `cs llm` — which then drives the coding agent to complete the task. Refer to `cs llm --help` for more on the Coding Agent feature.

When a follow-up event arrives (e.g. a comment update or task revision), the same flow is triggered again with updated context, allowing the agent to iterate on its previous work.

The entire flow is configurable — event sources, filtering rules, and prompt templates can all be tuned to support different automation behaviors.

## The Three Parts

```
┌────────────────────────┐     ┌────────────────────────┐     ┌────────────────────────┐
│        Watcher         │────▶│   Crafting Sandbox     │────▶│   Crafting Sandbox     │
│   (event listener &    │     │     Coding Agent       │     │       Runtime          │
│     orchestrator)      │     │  (built-in `cs llm`)   │     │ (execution environment)│
└────────────────────────┘     └────────────────────────┘     └────────────────────────┘

  Listens, filters,               Understands the task,          Runs the generated code,
  builds prompt,                  writes and iterates            provides tools & environment
  starts session via `cs llm`     on code changes
```

**[Watcher](./watcher.md)** handles:

- Receiving events via webhooks or polling
- Deduplication (skips if the bot already responded)
- Prompt construction from configurable Handlebars templates
- Launching the Crafting Sandbox Coding Agent session
- Posting status updates and follow-up comments back to the source platform

**Crafting Sandbox Coding Agent** (`cs llm`) is a built-in feature of the Crafting Sandbox system. Watcher invokes it with the rendered prompt to start a Coding Agent session, which drives the coding agent to understand the task, plan, and iteratively implement changes. Refer to `cs llm --help` for available options.
