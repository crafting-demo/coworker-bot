export interface ProviderAuth {
  type: 'token' | 'oauth' | 'basic' | 'none';
  token?: string;
  tokenEnv?: string;
  tokenFile?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ProviderMetadata {
  name: string;
  version: string;
}

export interface ProviderConfig {
  enabled: boolean;
  pollingInterval?: number;
  auth?: ProviderAuth;
  options?: Record<string, unknown>;
}

export interface Reactor {
  getLastComment(): Promise<{ author: string; body: string } | null>;
  postComment(comment: string): Promise<string>;
  isBotAuthor(author: string): boolean;
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
  };

  /** Actor who triggered the event */
  actor: {
    /** Actor username */
    username: string;

    /** Actor ID (provider-specific) */
    id: number | string;
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
