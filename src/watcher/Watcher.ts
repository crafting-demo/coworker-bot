import type {
  WatcherConfig,
  IProvider,
  EventHandler,
  Reactor,
  NormalizedEvent,
} from './types/index.js';
import { WatcherEventEmitter } from './core/EventEmitter.js';
import { ProviderRegistry } from './providers/ProviderRegistry.js';
import { WebhookServer } from './transport/WebhookServer.js';
import { WebhookHandler } from './transport/WebhookHandler.js';
import { Poller } from './transport/Poller.js';
import { CommandExecutor } from './utils/CommandExecutor.js';
import { logger } from './utils/logger.js';
import { WatcherError, ProviderError } from './utils/errors.js';
import { formatResourceLink } from './utils/linkFormatter.js';

export class Watcher extends WatcherEventEmitter {
  private registry: ProviderRegistry;
  private commentTemplate: string;
  private commandExecutor: CommandExecutor | undefined;
  private server: WebhookServer | undefined;
  private pollers: Map<string, Poller> = new Map();
  private started = false;

  constructor(private readonly config: WatcherConfig) {
    super();

    if (config.logLevel) {
      logger.setLevel(config.logLevel);
    }

    this.registry = new ProviderRegistry();

    if (!config.deduplication) {
      throw new WatcherError('Deduplication configuration is required');
    }

    this.commentTemplate =
      config.deduplication.commentTemplate || 'Agent is working on session {id}';

    if (config.commandExecutor?.enabled) {
      this.commandExecutor = new CommandExecutor(config.commandExecutor);
    }
  }

  registerProvider(name: string, provider: IProvider): void {
    if (this.started) {
      throw new WatcherError('Cannot register providers after watcher has started');
    }

    this.registry.register(name, provider);
  }

  unregisterProvider(name: string): void {
    if (this.started) {
      throw new WatcherError('Cannot unregister providers while watcher is running');
    }

    this.registry.unregister(name);
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new WatcherError('Watcher is already started');
    }

    logger.info('Starting watcher...');

    try {
      await this.initializeProviders();
      await this.startWebhookServer();
      await this.startPollers();

      this.started = true;
      this.emit('started');
      logger.info('Watcher started successfully');
    } catch (error) {
      logger.error('Failed to start watcher', error);
      await this.cleanup();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    logger.info('Stopping watcher...');

    try {
      this.stopPollers();

      if (this.server) {
        await this.server.stop();
        this.server = undefined;
      }

      await this.shutdownProviders();

      this.started = false;
      this.emit('stopped');
      logger.info('Watcher stopped successfully');
    } catch (error) {
      logger.error('Error during shutdown', error);
      throw error;
    }
  }

  private async initializeProviders(): Promise<void> {
    const providers = this.registry.getAll();

    if (providers.size === 0) {
      throw new WatcherError('No providers registered');
    }

    for (const [name, provider] of providers.entries()) {
      const providerConfig = this.config.providers[name];

      if (!providerConfig) {
        throw new ProviderError(`No configuration found for registered provider: ${name}`, name);
      }

      if (!providerConfig.enabled) {
        logger.info(`Provider ${name} is disabled, skipping initialization`);
        continue;
      }

      try {
        await provider.initialize(providerConfig);
        logger.info(`Initialized provider: ${name}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new ProviderError(
          `Failed to initialize provider '${name}': ${errorMessage}`,
          name,
          error
        );
      }
    }
  }

  private createEventHandler(providerName: string): EventHandler {
    return async (event: NormalizedEvent, reactor: Reactor) => {
      try {
        // Check for duplicates using reactor
        const isDuplicate = await this.isDuplicate(reactor);

        if (isDuplicate) {
          logger.debug(`Event from ${providerName} is a duplicate, skipping`);
          return;
        }

        // Emit event to subscribers
        logger.debug(`Emitting event from ${providerName}`);
        this.emit('event', providerName, event);

        // Execute command if configured
        if (this.commandExecutor) {
          // Generate display string from normalized event
          const displayString = this.generateDisplayString(event);
          await this.commandExecutor.execute(event.id, displayString, event, reactor);
        } else {
          // If no command executor, mark as processed manually
          await this.markAsProcessed(reactor, event);
        }
      } catch (error) {
        logger.error(`Error handling event from ${providerName}`, error);
        this.emit('error', error as Error);
      }
    };
  }

  /**
   * Determines if an event is a duplicate by checking the last comment/message.
   *
   * Deduplication Strategy:
   * To prevent processing the same event multiple times (e.g., due to webhook
   * re-delivery, polling overlap, or manual re-triggering), we check if the bot
   * has already responded to this issue/PR/thread.
   *
   * The check works by:
   * 1. Retrieving the last comment/message on the resource (issue/PR/thread)
   * 2. Checking if that comment was authored by the bot (using configured bot usernames)
   * 3. If the bot was the last to comment, assume this event was already processed
   *
   * Why this works:
   * - When the bot processes an event, it posts a "working on it" comment
   * - If that's still the last comment, no new human interaction has occurred
   * - If a human has commented since, the bot should process the new interaction
   *
   * Edge cases handled:
   * - No comments yet: Not a duplicate (new issue/PR)
   * - Error fetching comments: Assume not duplicate (fail safe)
   * - Multiple bot usernames: Supports checking against multiple bot accounts
   *
   * @param reactor - Provider-specific reactor for checking comments/messages
   * @returns true if this appears to be a duplicate event, false if should be processed
   */
  private async isDuplicate(reactor: Reactor): Promise<boolean> {
    try {
      const lastComment = await reactor.getLastComment();

      if (!lastComment) {
        logger.debug('No comments found, not a duplicate');
        return false;
      }

      // Check if last comment author is a bot using provider-specific logic
      const isDuplicate = reactor.isBotAuthor(lastComment.author);

      logger.debug('Checking for duplicate:', {
        lastCommentAuthor: lastComment.author,
        isDuplicate,
      });

      if (isDuplicate) {
        logger.info(`Duplicate detected - last comment by bot (${lastComment.author})`);
      } else {
        logger.debug(`Not a duplicate - last comment by ${lastComment.author}`);
      }

      return isDuplicate;
    } catch (error) {
      logger.error('Error checking for duplicate via comments', error);
      return false;
    }
  }

  private async markAsProcessed(reactor: Reactor, event: NormalizedEvent): Promise<void> {
    try {
      // Generate a user-friendly display string from the event for the comment template
      const displayString = this.generateDisplayString(event);
      const comment = this.commentTemplate.replace('{id}', displayString);

      await reactor.postComment(comment);
      logger.debug(`Posted deduplication comment`);
    } catch (error) {
      logger.error('Error posting comment', error);
    }
  }

  private generateDisplayString(event: NormalizedEvent): string {
    // Generate a user-friendly clickable link from normalized event
    // Format depends on provider: markdown [text](url) or Slack <url|text>
    return formatResourceLink(event);
  }

  private async startWebhookServer(): Promise<void> {
    const needsWebhook = Array.from(this.registry.getAll().entries()).some(([name]) => {
      const config = this.config.providers[name];
      return config?.enabled;
    });

    if (!needsWebhook) {
      logger.info('No webhook providers configured, skipping server startup');
      return;
    }

    const serverConfig = this.config.server || {
      host: '0.0.0.0',
      port: 3000,
    };

    this.server = new WebhookServer(serverConfig);

    for (const [name, provider] of this.registry.getAll().entries()) {
      const config = this.config.providers[name];

      if (!config?.enabled) {
        continue;
      }

      const eventHandler = this.createEventHandler(name);
      const handler = new WebhookHandler(provider, eventHandler);

      this.server.registerWebhook(name, handler.handle.bind(handler));
    }

    await this.server.start();
  }

  private async startPollers(): Promise<void> {
    for (const [name, provider] of this.registry.getAll().entries()) {
      const config = this.config.providers[name];

      if (!config?.enabled) {
        continue;
      }

      // Skip if no pollingInterval configured
      if (!config.pollingInterval) {
        logger.debug(`Skipping poller for ${name}: no pollingInterval configured`);
        continue;
      }

      // Check if provider has necessary configuration for polling
      const hasAuth = config.auth !== undefined;
      if (!hasAuth) {
        logger.debug(`Skipping poller for ${name}: no auth configured`);
        continue;
      }

      // Provider-specific checks for polling configuration
      const options = config.options as
        | {
            repositories?: string[];
            projects?: string[];
            teams?: string[];
          }
        | undefined;

      const hasPollingConfig =
        (options?.repositories && options.repositories.length > 0) || // GitHub/GitLab
        (options?.projects && options.projects.length > 0) || // GitLab
        (options?.teams && options.teams.length > 0) || // Linear
        (name === 'linear' && hasAuth); // Linear can poll all teams

      if (!hasPollingConfig) {
        logger.debug(`Skipping poller for ${name}: no repositories/projects/teams configured`);
        continue;
      }

      const intervalMs = config.pollingInterval * 1000;
      const eventHandler = this.createEventHandler(name);

      const poller = new Poller(provider, intervalMs, eventHandler);

      this.pollers.set(name, poller);
      poller.start();
      logger.info(`Started poller for ${name} (interval: ${config.pollingInterval}s)`);
    }
  }

  private stopPollers(): void {
    for (const [name, poller] of this.pollers.entries()) {
      poller.stop();
      logger.debug(`Stopped poller: ${name}`);
    }
    this.pollers.clear();
  }

  private async shutdownProviders(): Promise<void> {
    for (const [name, provider] of this.registry.getAll().entries()) {
      try {
        await provider.shutdown();
        logger.debug(`Shutdown provider: ${name}`);
      } catch (error) {
        logger.error(`Error shutting down provider ${name}`, error);
      }
    }
  }

  private async cleanup(): Promise<void> {
    this.stopPollers();

    if (this.server) {
      try {
        await this.server.stop();
      } catch (error) {
        logger.error('Error stopping server during cleanup', error);
      }
      this.server = undefined;
    }
  }

  get isStarted(): boolean {
    return this.started;
  }
}
