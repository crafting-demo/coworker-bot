import { BaseProvider } from '../BaseProvider.js';
import type {
  ProviderConfig,
  ProviderMetadata,
  EventHandler,
  NormalizedEvent,
} from '../../types/index.js';
import { ConfigLoader } from '../../core/ConfigLoader.js';
import { GitHubWebhook } from './GitHubWebhook.js';
import { GitHubPoller } from './GitHubPoller.js';
import { GitHubComments } from './GitHubComments.js';
import { GitHubReactor } from './GitHubReactor.js';
import {
  normalizeWebhookEvent,
  normalizePolledEvent,
  type GitHubWebhookPayload,
} from './GitHubNormalizer.js';
import { isBotMentionedInText, isBotAssignedInList } from '../../utils/eventFilter.js';
import { ProviderError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

type GitHubEventConfig = { actions: string[]; skipActions: string[] };

export class GitHubProvider extends BaseProvider {
  private webhook: GitHubWebhook | undefined;
  private poller: GitHubPoller | undefined;
  private comments: GitHubComments | undefined;
  private token: string | undefined;
  private botUsernames: string[] = [];

  private static readonly DEFAULT_WEBHOOK_EVENTS: Record<string, GitHubEventConfig> = {
    issues: { actions: ['all'], skipActions: [] },
    pull_request: {
      actions: ['all'],
      skipActions: [
        'opened',
        'synchronize',
        'edited',
        'labeled',
        'unlabeled',
        'assigned',
        'unassigned',
        'locked',
        'unlocked',
        'review_requested',
      ],
    },
    issue_comment: { actions: ['all'], skipActions: [] },
  };

  private eventFilter: Record<string, GitHubEventConfig> = {
    ...GitHubProvider.DEFAULT_WEBHOOK_EVENTS,
  };

  get metadata(): ProviderMetadata {
    return {
      name: 'github',
      version: '1.0.0',
    };
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    const modes: string[] = [];

    if (config.auth) {
      this.token = ConfigLoader.resolveSecret(
        config.auth.token,
        config.auth.tokenEnv,
        config.auth.tokenFile
      );

      if (this.token) {
        this.comments = new GitHubComments(this.token);
      }
    }

    const options = config.options as
      | {
          webhookSecret?: string;
          webhookSecretEnv?: string;
          webhookSecretFile?: string;
          repositories?: string[];
          initialLookbackHours?: number;
          maxItemsPerPoll?: number;
          botUsername?: string | string[];
          eventFilter?: Record<string, { actions?: string[]; skipActions?: string[] }>;
        }
      | undefined;

    // Read bot username(s) for deduplication — auto-detect from PAT if not configured
    if (options?.botUsername) {
      this.botUsernames = Array.isArray(options.botUsername)
        ? options.botUsername
        : [options.botUsername];
      logger.debug(`GitHub bot usernames configured: ${this.botUsernames.join(', ')}`);
    } else if (this.comments) {
      const detected = await this.comments.getAuthenticatedUser();
      if (detected) {
        this.botUsernames = [detected];
        logger.info(`GitHub bot username auto-detected from PAT: ${detected}`);
      } else {
        logger.warn(
          'GitHub: botUsername not configured and auto-detection failed - deduplication will not work'
        );
      }
    } else {
      logger.warn('GitHub: No botUsername configured - deduplication will not work');
    }

    // Resolve webhook secret if provided
    const webhookSecret = ConfigLoader.resolveSecret(
      options?.webhookSecret,
      options?.webhookSecretEnv,
      options?.webhookSecretFile
    );

    this.webhook = new GitHubWebhook(webhookSecret);
    modes.push('webhook');

    if (options?.eventFilter) {
      const configured: Record<string, GitHubEventConfig> = {};
      for (const [eventType, eventConfig] of Object.entries(options.eventFilter)) {
        const defaults = GitHubProvider.DEFAULT_WEBHOOK_EVENTS[eventType];
        configured[eventType] = {
          actions: eventConfig?.actions ?? defaults?.actions ?? ['all'],
          skipActions: eventConfig?.skipActions ?? defaults?.skipActions ?? [],
        };
      }
      this.eventFilter = configured;
    }
    logger.info(`GitHub event filter: ${Object.keys(this.eventFilter).join(', ')}`);

    // Auto-detect repositories from PAT if not explicitly configured
    let repositories = options?.repositories ?? [];
    if (this.token && repositories.length === 0 && this.comments) {
      repositories = await this.comments.getAccessibleRepositories();
      if (repositories.length > 0) {
        logger.info(`GitHub repositories auto-detected from PAT: ${repositories.join(', ')}`);
      }
    }

    const hasPollingConfig = this.token && repositories.length > 0;

    if (hasPollingConfig) {
      const pollerConfig: {
        token: string;
        repositories: string[];
        events: string[];
        initialLookbackHours?: number;
        maxItemsPerPoll?: number;
      } = {
        token: this.token!,
        repositories,
        events: Object.keys(this.eventFilter),
      };

      if (options?.initialLookbackHours !== undefined) {
        pollerConfig.initialLookbackHours = options.initialLookbackHours;
      }

      if (options?.maxItemsPerPoll !== undefined) {
        pollerConfig.maxItemsPerPoll = options.maxItemsPerPoll;
      }

      this.poller = new GitHubPoller(pollerConfig);
      modes.push('polling');
    }

    logger.info(`GitHub provider initialized with modes: ${modes.join(', ')}`);
  }

  async validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    _body: unknown,
    rawBody?: string | Buffer
  ): Promise<boolean> {
    if (!this.webhook) {
      return false;
    }

    const result = this.webhook.validate(headers, rawBody || '');
    return result.valid;
  }

  async handleWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    eventHandler: EventHandler
  ): Promise<void> {
    if (!this.webhook) {
      throw new ProviderError('GitHub webhook not initialized', 'github');
    }

    if (!this.comments) {
      throw new ProviderError('GitHub comments not initialized (token required)', 'github');
    }

    const { event, deliveryId } = this.webhook.extractMetadata(headers);
    const payload = body as GitHubWebhookPayload;

    logger.debug(`Processing GitHub ${event} event (delivery: ${deliveryId})`);

    const eventConfig = this.eventFilter[event];
    if (!eventConfig) {
      logger.debug(`Skipping GitHub ${event} event - not in configured eventFilter`);
      return;
    }

    // Early filtering: Check if this is a supported event type
    let resourceType: string;
    let resourceNumber: number;

    if (event === 'issues' && payload.issue) {
      resourceType = 'issue';
      resourceNumber = payload.issue.number;
    } else if (event === 'pull_request' && payload.pull_request) {
      resourceType = 'pull_request';
      resourceNumber = payload.pull_request.number;
    } else if (event === 'issue_comment' && payload.issue) {
      resourceType = payload.issue.pull_request ? 'pull_request' : 'issue';
      resourceNumber = payload.issue.number;
    } else {
      logger.debug(`Unsupported GitHub event type: ${event}`);
      return;
    }

    // Normalize event first to apply shared filtering logic
    const normalizedEvent = normalizeWebhookEvent(payload, deliveryId);

    // Apply shared filtering logic
    if (
      !this.shouldProcessEvent(
        normalizedEvent,
        undefined,
        eventConfig.actions,
        eventConfig.skipActions
      )
    ) {
      return; // Event filtered out (already logged in shouldProcessEvent)
    }

    // Enrich PR events with branch info when missing (issue_comment events on PRs
    // only include the issue payload, which lacks head.ref / base.ref)
    if (normalizedEvent.type === 'pull_request' && !normalizedEvent.resource.branch) {
      const prDetails = await this.comments.getPullRequest(
        payload.repository.full_name,
        resourceNumber
      );
      if (prDetails) {
        normalizedEvent.resource.branch = prDetails.branch;
        normalizedEvent.resource.mergeTo = prDetails.mergeTo;
        logger.debug(`Enriched PR #${resourceNumber} with branch: ${prDetails.branch}`);
      }
    }

    // Create reactor and process event
    const reactor = new GitHubReactor(
      this.comments,
      payload.repository.full_name,
      resourceType,
      resourceNumber,
      this.botUsernames
    );

    await eventHandler(normalizedEvent, reactor);
  }

  private shouldProcessEvent(
    event: NormalizedEvent,
    hasRecentComments?: boolean,
    actions: string[] = ['all'],
    skipActions: string[] = []
  ): boolean {
    const { type, action, resource } = event;

    // Allowlist check: skip if action not in allowlist (unless 'all' is present)
    if (!actions.includes('all') && !actions.includes(action)) {
      logger.debug(
        `Skipping ${type} #${resource.number} ${action} event - not in actions allowlist`
      );
      return false;
    }

    // Denylist check
    if (skipActions.includes(action)) {
      logger.debug(`Skipping ${type} #${resource.number} ${action} event`);
      return false;
    }

    // Assignment/mention filter: only process if bot is involved
    if (this.botUsernames.length === 0) {
      logger.error(`Skipping ${type} #${resource.number} - botUsername not configured`);
      return false;
    }
    if (resource.comment) {
      if (!isBotMentionedInText(resource.comment.body, this.botUsernames)) {
        logger.debug(`Skipping ${type} #${resource.number} comment - bot not mentioned`);
        return false;
      }
    } else {
      if (!isBotAssignedInList(resource.assignees, this.botUsernames, (a) => (a as any).login)) {
        logger.debug(`Skipping ${type} #${resource.number} - bot not assigned`);
        return false;
      }
    }

    // For polled events, skip if no recent human interaction
    if (type === 'pull_request' && action === 'poll' && hasRecentComments === false) {
      logger.debug(
        `Skipping polled PR #${resource.number} - only updated due to commits, no new comments`
      );
      return false;
    }

    // Skip closed/merged items unless they're being reopened
    if (resource.state === 'closed' && action !== 'reopened') {
      logger.debug(`Skipping closed/merged ${type} #${resource.number}`);
      return false;
    }

    return true;
  }

  /**
   * Checks if a PR has recent human interaction (comments, reviews).
   *
   * Purpose:
   * When polling for PR updates, we need to distinguish between:
   * 1. PR updated because author pushed new commits → SKIP (automated action)
   * 2. PR updated because someone commented/reviewed → PROCESS (human interaction)
   *
   * This method examines the last 5 comments/reviews to determine if there's
   * human activity beyond just commit pushes. This prevents the bot from
   * unnecessarily processing PRs that are only being updated by the author's commits.
   *
   * "Recent" is defined as: within the polling window (last poll to now).
   * The method checks the 5 most recent comments/reviews since that typically
   * covers activity within a single polling interval.
   *
   * @param repository - The repository in "owner/repo" format
   * @param prNumber - The pull request number
   * @returns true if recent human comments/reviews found, false if only commits/bot activity
   */
  private async hasRecentHumanInteraction(repository: string, prNumber: number): Promise<boolean> {
    if (!this.comments) {
      return true; // If we can't check, assume there is interaction
    }

    try {
      // Check for recent comments (last 5 comments)
      const comments = await this.comments.listComments(repository, prNumber, 5);

      // If there are any comments, consider it as having interaction
      // The deduplication system will handle if the bot already commented
      if (comments.length > 0) {
        logger.debug(`PR #${prNumber} has ${comments.length} recent comment(s)`);
        return true;
      }

      logger.debug(`PR #${prNumber} has no recent comments`);
      return false;
    } catch (error) {
      logger.warn(`Failed to check comments for PR #${prNumber}`, error);
      // On error, assume there is interaction to avoid missing important events
      return true;
    }
  }

  async poll(eventHandler: EventHandler): Promise<void> {
    if (!this.poller) {
      throw new ProviderError('GitHub poller not initialized', 'github');
    }

    if (!this.comments) {
      throw new ProviderError('GitHub comments not initialized (token required)', 'github');
    }

    const items = await this.poller.poll();

    logger.debug(`Processing ${items.length} items from GitHub poll`);

    for (const item of items) {
      const repository = item.repository;
      const resourceType = item.type === 'issue' ? 'issue' : 'pull_request';
      const resourceNumber = item.number;

      const webhookKey = item.type === 'issue' ? 'issues' : 'pull_request';
      const pollEventConfig = this.eventFilter[webhookKey];
      if (!pollEventConfig) {
        logger.debug(`Skipping polled ${item.type} - not in configured eventFilter`);
        continue;
      }

      // For PRs, check if there are recent comments to distinguish
      // between commit updates (skip) vs human interaction (process)
      let hasRecentComments: boolean | undefined;
      if (resourceType === 'pull_request') {
        hasRecentComments = await this.hasRecentHumanInteraction(repository, resourceNumber);
      }

      // Normalize event first to apply shared filtering logic
      const normalizedEvent = normalizePolledEvent(item);

      // Apply shared filtering logic (same as webhooks)
      if (
        !this.shouldProcessEvent(
          normalizedEvent,
          hasRecentComments,
          pollEventConfig.actions,
          pollEventConfig.skipActions
        )
      ) {
        continue; // Event filtered out (already logged in shouldProcessEvent)
      }

      logger.debug(`Creating reactor for ${resourceType} #${resourceNumber} in ${repository}`);

      const reactor = new GitHubReactor(
        this.comments,
        repository,
        resourceType,
        resourceNumber,
        this.botUsernames
      );

      logger.debug(`Calling event handler for ${resourceType} #${resourceNumber}`);
      await eventHandler(normalizedEvent, reactor);
    }

    logger.debug(`Finished processing ${items.length} items from GitHub poll`);
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.webhook = undefined;
    this.poller = undefined;
    this.comments = undefined;
    this.token = undefined;
  }
}
