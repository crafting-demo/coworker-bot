# Development Guide

This guide provides detailed information for developers and contributors working on coworker-bot.

## Architecture

### Directory Structure

```
coworker-bot/
├── src/
│   ├── watcher/              # Watcher subsystem
│   │   ├── types/            # Type definitions
│   │   │   ├── config.ts
│   │   │   ├── index.ts
│   │   │   └── provider.ts
│   │   ├── core/             # Core components
│   │   │   ├── ConfigLoader.ts
│   │   │   └── EventEmitter.ts
│   │   ├── transport/        # HTTP server and polling
│   │   │   ├── WebhookServer.ts
│   │   │   ├── WebhookHandler.ts
│   │   │   └── Poller.ts
│   │   ├── providers/        # Provider implementations
│   │   │   ├── BaseProvider.ts
│   │   │   ├── ProviderRegistry.ts
│   │   │   ├── github/
│   │   │   ├── gitlab/
│   │   │   ├── linear/
│   │   │   └── slack/
│   │   ├── utils/            # Utilities
│   │   │   ├── CommandExecutor.ts
│   │   │   ├── crypto.ts
│   │   │   ├── errors.ts
│   │   │   ├── linkFormatter.ts
│   │   │   ├── logger.ts
│   │   │   └── retry.ts
│   │   ├── index.ts          # Library exports
│   │   └── Watcher.ts        # Main watcher class
│   ├── standalone.ts         # Standalone entry point
│   └── index.ts              # Main entry point
├── config/                   # Configuration files
│   ├── watcher.full.yaml
│   └── event-prompt.hbs
└── docs/                     # Documentation
    ├── overview.md
    ├── watcher.md
    ├── quickstart.md
    ├── setup/
    │   ├── index.md
    │   ├── configuration.md
    │   ├── security.md
    │   ├── github.md
    │   ├── linear.md
    │   └── slack.md
    └── examples/flows/
        ├── github-issue-to-pr-flow.md
        └── slack-thread-to-pr-flow.md
```

## Core Concepts

### Reactor Pattern

Each provider normalizes its platform-specific payload into a common `NormalizedEvent` shape and provides a **Reactor** interface for performing commenting operations back on the source platform:

```typescript
interface Reactor {
  getLastComment(): Promise<{ author: string; body: string } | null>;
  postComment(comment: string): Promise<string>;
  isBotAuthor(author: string): boolean;
}
```

This provides a consistent interface for deduplication and comment posting, regardless of provider.

### Event Flow

1. **Event Received** (webhook or poll)
2. **Provider Validates** (signature verification for webhooks)
3. **Deduplication Check** (via reactor.getLastComment())
4. **If not duplicate**:
   - Provider normalizes event to `NormalizedEvent` format
   - CommandExecutor renders prompt template
   - Posts initial comment: "Agent is working on owner/repo#123"
   - Executes configured command
   - Optionally updates comment with command output

### Command Execution

The CommandExecutor component handles running external commands when events are received:

- Renders Handlebars templates with event data
- Executes shell commands with event context
- Passes prompts via stdin or environment variables
- Posts/updates comments with command output

Example configuration:

```yaml
commandExecutor:
  enabled: true
  command: 'cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task'
  promptTemplateFile: ./config/event-prompt.hbs
  useStdin: true # Pass prompt to stdin
  followUp: true # Update comment with output
```

### Deduplication

The watcher uses **comment-based deduplication** to prevent processing the same event multiple times:

- Before processing, checks if last comment author matches `botUsername`
- After processing, posts a comment like "Agent is working on owner/repo#123"
- Works across restarts and in distributed environments
- Self-documenting (visible in issue/PR history)

**Requirements:**

- Provider must support comment operations
- Bot account needs write access
- `botUsername` must match the posting account

## Library Usage

The watcher can be used as a library in your own application:

```typescript
import { Watcher, GitHubProvider } from './src/watcher/index.js';

const watcher = new Watcher({
  server: { host: 'localhost', port: 3000 },
  providers: {
    github: {
      enabled: true,
      pollingInterval: 60,
      auth: { type: 'token', tokenEnv: 'GITHUB_TOKEN' },
      options: {
        webhookSecretEnv: 'GITHUB_WEBHOOK_SECRET',
        botUsername: 'coworker-bot-bot',
        repositories: ['owner/repo'],
        initialLookbackHours: 1,
      },
    },
  },
  deduplication: {
    enabled: true,
  },
  commandExecutor: {
    enabled: true,
    command: 'your-command',
    promptTemplateFile: './prompt.hbs',
  },
});

watcher.registerProvider('github', new GitHubProvider());

watcher.on('event', (providerName, event) => {
  console.log(`Event from ${providerName}:`, event);
});

watcher.on('error', (error) => {
  console.error('Watcher error:', error);
});

await watcher.start();

// Later: graceful shutdown
await watcher.stop();
```

## Adding Custom Providers

To add a new provider beyond the built-in ones (GitHub, Linear, Slack):

1. **Implement the IProvider interface:**

```typescript
import { BaseProvider } from './src/watcher/providers/BaseProvider.js';
import type { ProviderConfig, EventHandler, Reactor } from './src/watcher/types/index.js';

export class CustomProvider extends BaseProvider {
  get metadata() {
    return {
      name: 'custom',
      version: '1.0.0',
    };
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    // Initialize your provider
  }

  async validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody?: string | Buffer
  ): Promise<boolean> {
    // Validate webhook (signature, headers, etc.)
    return true;
  }

  async handleWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    eventHandler: EventHandler
  ): Promise<void> {
    // Create reactor for commenting
    const reactor: Reactor = {
      async getLastComment() {
        /* ... */
      },
      async postComment(comment: string) {
        /* ... */
      },
      isBotAuthor(author: string) {
        /* ... */ return false;
      },
    };

    // Normalize event internally (for templates)
    const normalizedEvent = this.normalize(body);

    // Call event handler
    await eventHandler(normalizedEvent, reactor);
  }

  async poll(eventHandler: EventHandler): Promise<void> {
    // Poll provider API and call eventHandler for each item
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    // Clean up resources
  }
}
```

2. **Register the provider:**

```typescript
watcher.registerProvider('custom', new CustomProvider());
```

3. **Add configuration:**

```yaml
providers:
  custom:
    enabled: true
    pollingInterval: 60
    auth:
      type: token
      tokenEnv: CUSTOM_TOKEN
    options:
      # Provider-specific options
```

## Development Scripts

- `pnpm start` - Run the watcher with tsx
- `pnpm run build` - Compile TypeScript to JavaScript
- `pnpm run type-check` - Check types without building
- `pnpm test` - Run tests

## Logging

The watcher uses colored console logging with different levels:

- **DEBUG** (gray): Detailed debugging information
- **INFO** (green): General information
- **WARN** (yellow): Warning messages
- **ERROR** (red): Error messages

Set log level in configuration:

```yaml
logLevel: info # debug | info | warn | error
```

## Error Handling

- **Webhook errors**: Logged but don't crash the server
- **Polling errors**: Exponential backoff with retry
- **Command execution errors**: Logged with full context
- **Provider errors**: Isolated per provider (one failing provider doesn't affect others)
- **Graceful shutdown**: Handles SIGTERM/SIGINT with proper cleanup

## Security Considerations

1. **Use webhook secrets** for signature verification (prevents unauthorized requests)
2. **Restrict token permissions** to minimum required (Issues + PRs read/write)
3. **Use environment variables** for secrets (never commit secrets to git)
4. **Run behind reverse proxy** in production (nginx, Caddy) for HTTPS and rate limiting
5. **Validate inputs** at provider level before processing

## Contributing

Contributions are welcome! Please ensure:

- TypeScript code passes type checking (`pnpm run type-check`)
- Code follows existing patterns and conventions
- New providers implement the full `IProvider` interface
- Configuration examples are updated for new features
