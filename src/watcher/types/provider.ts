/**
 * Authentication configuration for a provider.
 *
 * Secrets are resolved in priority order: inline value → environment variable → file.
 * Only one of token/tokenEnv/tokenFile (or username+password) should be set.
 */
export interface ProviderAuth {
  /** Authentication scheme used by this provider. */
  type: 'token' | 'oauth' | 'basic' | 'none';

  // --- Token-based auth (GitHub, GitLab, Linear, Slack, Jira) ---

  /** Inline secret token (not recommended for production; prefer tokenEnv or tokenFile). */
  token?: string;
  /** Name of the environment variable that holds the secret token (e.g. "GITHUB_TOKEN"). */
  tokenEnv?: string;
  /** Path to a file whose contents are the secret token (useful with Docker secrets). */
  tokenFile?: string;

  // --- Basic auth (username + password) ---

  /** Username for basic authentication. */
  username?: string;
  /** Password for basic authentication. */
  password?: string;

  // --- OAuth ---

  /** OAuth client ID. */
  clientId?: string;
  /** OAuth client secret. */
  clientSecret?: string;
}

/**
 * Identifies a provider implementation.
 * Used for logging, metrics, and display purposes.
 */
export interface ProviderMetadata {
  /** Stable machine-readable name (e.g. "github", "linear", "slack"). */
  name: string;
  /** Semver version of the provider implementation (e.g. "1.0.0"). */
  version: string;
}

/**
 * Runtime configuration for a single provider instance, sourced from watcher.yaml.
 *
 * Providers read `auth` for credentials and `options` for provider-specific settings
 * (e.g. webhook secrets, team filters, event type allowlists).
 */
export interface ProviderConfig {
  /** Whether this provider is active. When false, the provider is not initialized. */
  enabled: boolean;

  /**
   * How often (in milliseconds) the Watcher calls poll() for this provider.
   * Omit to disable polling (webhook-only mode).
   */
  pollingInterval?: number;

  /** Credentials used to authenticate with the provider's API. */
  auth?: ProviderAuth;

  /**
   * Provider-specific settings (e.g. signingSecret, teams, eventFilter).
   * Each provider documents its own supported keys.
   */
  options?: Record<string, unknown>;
}

/**
 * Resource-scoped interface passed to the Watcher's event handler alongside each
 * NormalizedEvent.  A Reactor encapsulates all provider API calls that operate on
 * a single resource (issue, PR, thread, etc.) so the Watcher can remain provider-agnostic.
 *
 * Deduplication contract
 * ----------------------
 * The Watcher calls getLastComment() to decide whether the bot already responded.
 * If isBotAuthor() returns true for that comment's author, the event is a duplicate
 * and postComment() + enrichEvent() are skipped entirely.
 *
 * Two-phase context retrieval
 * ---------------------------
 * Providers should avoid expensive API fetches (full comment history, thread content)
 * until the Watcher confirms the event is not a duplicate.  The optional enrichEvent()
 * hook is the designated place for those deferred fetches; it is called only after the
 * dedup check passes and before the prompt is rendered.
 */
export interface Reactor {
  /**
   * Returns the most recent comment on the resource, or null if there are none.
   *
   * Used by the Watcher for deduplication: if the last comment was written by the
   * bot itself (isBotAuthor() returns true), the event is considered a duplicate
   * and further processing is skipped.
   *
   * Implementations may cache the result to avoid a redundant API call in enrichEvent().
   */
  getLastComment(): Promise<{ author: string; body: string } | null>;

  /**
   * Posts a new comment on the resource and returns a provider-specific comment ID.
   *
   * Called after prompt execution to deliver the bot's response back to the user.
   * The returned ID may be used for logging or follow-up edits.
   */
  postComment(comment: string): Promise<string>;

  /**
   * Returns true if the given author string matches the bot's identity.
   *
   * Used after getLastComment() to determine whether the bot was the last commenter.
   * Comparison should be case-insensitive and may check multiple aliases (username,
   * display name, user ID) depending on what the provider returns.
   */
  isBotAuthor(author: string): boolean;

  /**
   * Optional: enrich a thin NormalizedEvent with full context (e.g. comment history,
   * full description) that is needed for prompt rendering but not for deciding whether
   * to trigger.  Called by the Watcher *after* the dedup check passes, so expensive
   * API fetches are skipped entirely for duplicate events.
   *
   * Providers that pre-fetched context inside getLastComment() should cache and reuse
   * it here to avoid a second API round-trip (see LinearReactor for an example).
   *
   * Failures should be non-fatal: log a warning and return without throwing so that
   * the Watcher can still render the prompt with whatever partial context is available.
   */
  enrichEvent?(event: NormalizedEvent): Promise<void>;
}

/**
 * Normalized event structure that all providers must map to.
 * This provides a consistent interface for command execution and event handling.
 */
export interface NormalizedEvent {
  /** Unique event identifier (e.g., "github:owner/repo:opened:123:uuid") */
  id: string;

  /** Provider name (e.g., "github", "gitlab", "jira") */
  provider: string;

  /** Event type (e.g., "issue", "pull_request", "task") */
  type: string;

  /** Action that triggered the event (e.g., "opened", "closed", "edited") */
  action: string;

  /** Resource information */
  resource: {
    /** Resource number/ID (e.g., issue #123) */
    number: number;

    /** Resource title/summary */
    title: string;

    /** Resource description/body */
    description: string;

    /** Resource URL */
    url: string;

    /** Resource state (e.g., "open", "closed") */
    state: string;

    /** Repository full name (e.g., "owner/repo") */
    repository: string;

    /** Author username */
    author?: string;

    /** Assignees (provider-specific structure) */
    assignees?: unknown[];

    /** Labels/tags */
    labels?: string[];

    /** Branch name (for PRs/MRs) */
    branch?: string;

    /** Target branch (for PRs/MRs) */
    mergeTo?: string;

    /** Comment information (when event is triggered by a comment) */
    comment?: {
      /** Comment body/content */
      body: string;
      /** Comment author */
      author: string;
      /** Comment URL (if available) */
      url?: string;
    };

    /** Full comment history (fetched by provider for full context) */
    comments?: Array<{
      body: string;
      author: string;
      createdAt?: string;
    }>;

    /** Check run information (when event is triggered by a failed check) */
    check?: {
      /** Name of the check (e.g. "CI / build", "test (ubuntu)") */
      name: string;
      /** Conclusion: failure | timed_out | cancelled | action_required */
      conclusion: string;
      /** URL to the check run details page */
      url: string;
      /** Optional output from the check */
      output?: {
        title?: string;
        summary?: string;
      };
    };
  };

  /** Actor who triggered the event */
  actor: {
    /** Actor username */
    username: string;

    /** Actor ID (provider-specific) */
    id: number | string;

    /** Actor email (when available, e.g. resolved from Slack users.info) */
    email?: string;
  };

  /** Event metadata */
  metadata: {
    /** Event timestamp */
    timestamp: string;

    /** Delivery ID (for webhooks) */
    deliveryId?: string;

    /** Whether this was from polling */
    polled?: boolean;

    /** Additional provider-specific metadata */
    [key: string]: unknown;
  };

  /** Original raw event from provider (for debugging/templates) */
  raw: unknown;
}

/**
 * Callback signature the Watcher passes to handleWebhook() and poll().
 *
 * Providers call this once per normalized event.  The Watcher implementation:
 *   1. Calls reactor.getLastComment() to check for duplicates.
 *   2. If not a duplicate, calls reactor.enrichEvent() (when present) to fetch full context.
 *   3. Renders the prompt template against the enriched NormalizedEvent.
 *   4. Executes the configured command and posts the result via reactor.postComment().
 */
export type EventHandler = (event: NormalizedEvent, reactor: Reactor) => Promise<void>;

/**
 * Provider interface for integrating with external platforms (GitHub, GitLab, Linear, Slack, etc.).
 *
 * Provider Lifecycle:
 * ==================
 *
 * 1. **Initialization** (once, during Watcher startup)
 *    - initialize() is called with provider configuration
 *    - Provider authenticates, validates config, sets up internal state
 *    - MUST succeed before any other methods are called
 *    - Failures here prevent the provider from being registered
 *
 * 2. **Event Reception** (ongoing, throughout runtime)
 *    - Two mechanisms: webhooks (real-time) and polling (periodic)
 *
 *    Webhook Flow:
 *    a) validateWebhook() - Verify request authenticity (HMAC signature, tokens, etc.)
 *    b) handleWebhook() - Parse payload, normalize event, call eventHandler
 *
 *    Polling Flow:
 *    a) poll() - Query provider API for new events
 *    b) For each event found: normalize and call eventHandler
 *
 * 3. **Shutdown** (once, during graceful shutdown)
 *    - shutdown() is called when Watcher stops
 *    - Provider should clean up resources (close connections, cancel timers, etc.)
 *    - Should complete quickly (within a few seconds)
 *
 * Key Responsibilities:
 * ====================
 * - **Normalize Events**: Convert provider-specific payloads to NormalizedEvent format
 * - **Create Reactors**: Instantiate provider-specific Reactor for comment handling
 * - **Authenticate**: Validate incoming webhooks and authenticate API requests
 * - **Error Handling**: Gracefully handle API errors, rate limits, and network issues
 * - **Deduplication Support**: Provide Reactor that can check/post comments for deduplication
 *
 * Threading Model:
 * ================
 * - All methods may be called concurrently
 * - handleWebhook() may be called while poll() is running
 * - Providers must be thread-safe (use locks if needed)
 * - Each call to handleWebhook() or poll() should be independent
 *
 * Error Handling:
 * ===============
 * - Throw ProviderError for provider-specific errors
 * - Log detailed errors for debugging
 * - Don't crash on single event failures (log and continue)
 * - Return false from validateWebhook() for invalid signatures (don't throw)
 */
export interface IProvider {
  /** Provider metadata (name, version) */
  readonly metadata: ProviderMetadata;

  /**
   * Initializes the provider with configuration.
   *
   * Called once during Watcher startup. Must complete successfully before
   * the provider can receive events.
   *
   * Responsibilities:
   * - Validate configuration (required fields, auth credentials)
   * - Authenticate with provider API (test credentials)
   * - Initialize internal state (API clients, caches, etc.)
   * - Set up any necessary timers or connections
   *
   * @param config - Provider configuration from watcher.yaml
   * @throws ProviderError if initialization fails (invalid config, auth failure, etc.)
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Validates an incoming webhook request.
   *
   * Called for each webhook received. Should verify the request came from
   * the expected provider (HMAC signature, webhook secret, etc.).
   *
   * Important:
   * - Return false for invalid signatures (don't throw)
   * - Validate as quickly as possible (webhooks are time-sensitive)
   * - Don't perform expensive operations here (save for handleWebhook)
   *
   * @param headers - HTTP request headers
   * @param body - Parsed JSON body
   * @param rawBody - Raw request body (for signature verification)
   * @returns true if webhook is valid, false if invalid/unauthenticated
   */
  validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody?: string | Buffer
  ): Promise<boolean>;

  /**
   * Processes a validated webhook event.
   *
   * Called after validateWebhook() returns true. Should parse the webhook
   * payload, normalize it to NormalizedEvent format, and invoke the eventHandler.
   *
   * Responsibilities:
   * - Parse provider-specific webhook payload
   * - Filter out events that shouldn't trigger actions (see GitHubProvider for examples)
   * - Normalize to NormalizedEvent format
   * - Create appropriate Reactor for the resource (issue/PR/thread)
   * - Invoke eventHandler with normalized event and reactor
   *
   * @param headers - HTTP request headers
   * @param body - Parsed JSON body
   * @param eventHandler - Callback to invoke with normalized event
   */
  handleWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    eventHandler: EventHandler
  ): Promise<void>;

  /**
   * Polls the provider API for new events.
   *
   * Called periodically based on pollingInterval configuration. Should query
   * the provider API for recent events and invoke eventHandler for each.
   *
   * Responsibilities:
   * - Query provider API for recent events (since last poll)
   * - Track last poll time to avoid re-processing events
   * - Filter out events that shouldn't trigger actions
   * - Normalize each event to NormalizedEvent format
   * - Create appropriate Reactor for each event
   * - Invoke eventHandler for each event
   * - Handle rate limits gracefully
   *
   * Note: Should be idempotent - safe to call multiple times without duplicating work.
   * Use deduplication (via Reactor) to prevent processing the same event twice.
   *
   * @param eventHandler - Callback to invoke with normalized events
   */
  poll(eventHandler: EventHandler): Promise<void>;

  /**
   * Gracefully shuts down the provider.
   *
   * Called once during Watcher shutdown. Should clean up resources and
   * complete quickly (within a few seconds).
   *
   * Responsibilities:
   * - Close API connections
   * - Cancel any timers or pending requests
   * - Flush any pending operations
   * - Clean up temporary resources
   *
   * Note: After shutdown(), no other methods will be called on this instance.
   */
  shutdown(): Promise<void>;
}
