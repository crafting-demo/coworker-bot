import { spawnSync } from 'child_process';
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
  normalizeCheckRunEvent,
  normalizeStatusEvent,
  type GitHubWebhookPayload,
  type GitHubCheckRunPayload,
  type GitHubStatusPayload,
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
  private tokenExpiry: number = 0;
  private static readonly TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes, matching nginx cache TTL
  private botUsernames: string[] = [];
  private triggerLabels: string[] = [];
  private watchChecks: boolean = false;

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
    check_run: { actions: ['completed'], skipActions: [] },
    status: { actions: ['all'], skipActions: [] },
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
      // Manual token from watcher.yaml auth block — static, no refresh.
      this.token = ConfigLoader.resolveSecret(
        config.auth.token,
        config.auth.tokenEnv,
        config.auth.tokenFile
      );
      if (this.token) {
        this.tokenExpiry = Infinity;
        this.comments = new GitHubComments(() => this.token ?? '');
      }
    } else if (process.env.GITHUB_ORG) {
      // GitHub App installation token fetched via wsenv, refreshed automatically every 55 minutes.
      this.refreshTokenIfNeeded();
      this.comments = new GitHubComments(() => {
        this.refreshTokenIfNeeded();
        return this.token ?? '';
      });
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
          triggerLabels?: string | string[];
          watchChecks?: boolean;
          eventFilter?: Record<string, { actions?: string[]; skipActions?: string[] }>;
        }
      | undefined;

    // Read bot username(s) for deduplication.
    // Auto-detection via GET /user works for PATs but NOT for GitHub App installation tokens
    // (which return 403). In GitHub App mode, users must set botUsername explicitly.
    if (options?.botUsername) {
      const raw = options.botUsername;
      this.botUsernames = Array.isArray(raw) ? raw : [raw];
      logger.debug(`GitHub bot usernames (configured): ${this.botUsernames.join(', ')}`);
    } else if (config.auth && this.comments) {
      // PAT mode — GET /user works fine
      const detected = await this.comments.getAuthenticatedUser();
      if (detected) {
        this.botUsernames = [detected];
        logger.debug(`GitHub bot usernames (auto-detected): ${this.botUsernames.join(', ')}`);
      } else {
        logger.warn(
          'GitHub: botUsername not configured and auto-detection failed - deduplication will not work'
        );
      }
    } else if (process.env.GITHUB_ORG) {
      // GitHub App mode — installation tokens cannot call GET /user (403)
      logger.warn(
        'GitHub: Using GitHub App auth but botUsername is not configured. ' +
          'Set GITHUB_BOT_USERNAME env var (e.g. "my-app[bot]") or botUsername in watcher.yaml - ' +
          'deduplication will not work until this is set'
      );
    } else {
      logger.warn('GitHub: No auth configured - botUsername auto-detection skipped');
    }

    if (options?.triggerLabels) {
      const raw = options.triggerLabels;
      this.triggerLabels = Array.isArray(raw) ? raw : [raw];
      logger.info(`GitHub trigger labels: ${this.triggerLabels.join(', ')}`);
    }

    if (options?.watchChecks) {
      this.watchChecks = true;
      logger.info('GitHub check failure watching enabled');
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

    // Auto-detect repositories from the GitHub App installation token if not explicitly configured.
    // GET /installation/repositories only works with App tokens, not PATs — skip in PAT mode.
    let repositories = options?.repositories ?? [];
    if (repositories.length === 0 && this.comments) {
      if (process.env.GITHUB_ORG) {
        repositories = await this.comments.getAccessibleRepositories();
        if (repositories.length > 0) {
          logger.info(`GitHub repositories auto-detected: ${repositories.join(', ')}`);
        }
      } else if (config.auth) {
        logger.warn(
          'GitHub: PAT mode requires explicit repositories configuration for polling. ' +
            'Set repositories in watcher.yaml options or GITHUB_REPOSITORIES env var.'
        );
      }
    }

    const hasPollingConfig = this.token && repositories.length > 0;

    if (hasPollingConfig) {
      const pollerConfig: {
        tokenGetter: () => string;
        repositories: string[];
        events: string[];
        initialLookbackHours?: number;
        maxItemsPerPoll?: number;
      } = {
        tokenGetter: () => {
          this.refreshTokenIfNeeded();
          return this.token!;
        },
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

    // check_run and status events have different payload shapes — handle separately
    if (event === 'check_run') {
      await this.handleCheckRunWebhook(
        body as GitHubCheckRunPayload,
        deliveryId,
        eventConfig,
        eventHandler
      );
      return;
    }

    if (event === 'status') {
      await this.handleStatusWebhook(body as GitHubStatusPayload, deliveryId, eventHandler);
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

  private async handleCheckRunWebhook(
    payload: GitHubCheckRunPayload,
    deliveryId: string,
    eventConfig: GitHubEventConfig,
    eventHandler: EventHandler
  ): Promise<void> {
    const checkRun = payload.check_run;
    const repository = payload.repository.full_name;

    // Only process completed events with a failure-like conclusion
    const failureConclusions = ['failure', 'timed_out', 'cancelled', 'action_required'];
    if (
      payload.action !== 'completed' ||
      !checkRun.conclusion ||
      !failureConclusions.includes(checkRun.conclusion)
    ) {
      logger.debug(
        `Skipping check_run "${checkRun.name}" - action=${payload.action} conclusion=${checkRun.conclusion}`
      );
      return;
    }

    // Only process check runs associated with a PR
    if (!checkRun.pull_requests || checkRun.pull_requests.length === 0) {
      logger.debug(`Skipping check_run "${checkRun.name}" - no associated pull requests`);
      return;
    }

    for (const prRef of checkRun.pull_requests) {
      const prNumber = prRef.number;

      // Fetch full PR details to populate resource fields and labels
      const prDetails = await this.comments!.getPullRequest(repository, prNumber);
      if (!prDetails) {
        logger.warn(`check_run: could not fetch PR #${prNumber} in ${repository}, skipping`);
        continue;
      }

      const prArg: {
        number: number;
        title: string;
        description: string;
        url: string;
        state: string;
        author?: string;
        labels?: string[];
        branch: string;
        mergeTo: string;
      } = {
        number: prNumber,
        title: prDetails.title,
        description: prDetails.description,
        url: prDetails.url,
        state: prDetails.state,
        branch: prRef.head.ref,
        mergeTo: prRef.base.ref,
      };
      if (prDetails.author) prArg.author = prDetails.author;
      if (prDetails.labels) prArg.labels = prDetails.labels;

      const normalizedEvent = normalizeCheckRunEvent(payload, prArg, deliveryId);

      if (
        !this.shouldProcessEvent(
          normalizedEvent,
          undefined,
          eventConfig.actions,
          eventConfig.skipActions
        )
      ) {
        continue;
      }

      const reactor = new GitHubReactor(
        this.comments!,
        repository,
        'pull_request',
        prNumber,
        this.botUsernames
      );

      await eventHandler(normalizedEvent, reactor);
    }
  }

  private async handleStatusWebhook(
    payload: GitHubStatusPayload,
    deliveryId: string,
    eventHandler: EventHandler
  ): Promise<void> {
    const repository = payload.repository.full_name;

    // Only process failure/error states
    if (payload.state !== 'failure' && payload.state !== 'error') {
      logger.debug(`Skipping status event for "${payload.context}" - state=${payload.state}`);
      return;
    }

    // Find open PRs whose HEAD is this commit
    const openPRs = await this.comments!.getPullRequestsForCommit(repository, payload.sha);
    if (openPRs.length === 0) {
      logger.debug(
        `Skipping status event for "${payload.context}" on ${payload.sha} - no open PRs`
      );
      return;
    }

    // Use a fixed eventFilter config — status events have no action sub-type
    const eventConfig = this.eventFilter['status'] ?? { actions: ['all'], skipActions: [] };

    for (const prRef of openPRs) {
      const prNumber = prRef.number;

      const prDetails = await this.comments!.getPullRequest(repository, prNumber);
      if (!prDetails) {
        logger.warn(`status: could not fetch PR #${prNumber} in ${repository}, skipping`);
        continue;
      }

      const prArg: {
        number: number;
        title: string;
        description: string;
        url: string;
        state: string;
        author?: string;
        labels?: string[];
        branch: string;
        mergeTo: string;
      } = {
        number: prNumber,
        title: prDetails.title,
        description: prDetails.description,
        url: prDetails.url,
        state: prDetails.state,
        branch: prRef.head.ref,
        mergeTo: prRef.base.ref,
      };
      if (prDetails.author) prArg.author = prDetails.author;
      if (prDetails.labels) prArg.labels = prDetails.labels;

      const normalizedEvent = normalizeStatusEvent(payload, prArg, deliveryId);

      if (
        !this.shouldProcessEvent(
          normalizedEvent,
          undefined,
          eventConfig.actions,
          eventConfig.skipActions
        )
      ) {
        continue;
      }

      const reactor = new GitHubReactor(
        this.comments!,
        repository,
        'pull_request',
        prNumber,
        this.botUsernames
      );

      await eventHandler(normalizedEvent, reactor);
    }
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

    // Always skip comments authored by the bot itself (e.g. deduplication comments it posted).
    // This must run unconditionally — before trigger label and assignment checks — to avoid
    // the bot reacting to its own output regardless of how the event was admitted.
    if (resource.comment) {
      if (
        this.botUsernames.some((n) => n.toLowerCase() === resource.comment!.author.toLowerCase())
      ) {
        logger.debug(`Skipping ${type} #${resource.number} comment - authored by bot`);
        return false;
      }
    }

    // Trigger label check: if configured and the resource has a matching label, bypass
    // the assignment/mention requirement entirely.
    const lowerTriggerLabels = this.triggerLabels.map((l) => l.toLowerCase());
    const hasTriggeredByLabel =
      lowerTriggerLabels.length > 0 &&
      resource.labels?.some((l) => lowerTriggerLabels.includes(l.toLowerCase()));

    // Check failure: admitted if watchChecks=true or a trigger label matches
    const isCheckFailure = action === 'check_failed';
    if (isCheckFailure) {
      if (this.watchChecks || hasTriggeredByLabel) {
        logger.debug(
          `${type} #${resource.number} check failure admitted (watchChecks=${this.watchChecks}, labelMatch=${hasTriggeredByLabel})`
        );
      } else {
        logger.debug(
          `Skipping ${type} #${resource.number} check failure - watchChecks not enabled and no trigger label`
        );
        return false;
      }
    } else if (hasTriggeredByLabel) {
      logger.debug(
        `${type} #${resource.number} matches trigger label - bypassing assignment check`
      );
    } else {
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
  private async hasRecentHumanInteraction(
    repository: string,
    prNumber: number,
    since?: Date
  ): Promise<boolean> {
    if (!this.comments) {
      return true; // If we can't check, assume there is interaction
    }

    try {
      const comments = await this.comments.listComments(repository, prNumber, 5, since);

      if (comments.length > 0) {
        logger.debug(`PR #${prNumber} has ${comments.length} comment(s) since last poll`);
        return true;
      }

      logger.debug(`PR #${prNumber} has no comments since last poll`);
      return false;
    } catch (error) {
      logger.warn(`Failed to check comments for PR #${prNumber}`, error);
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
        const since = this.poller!.getLastPollTime(repository);
        hasRecentComments = await this.hasRecentHumanInteraction(repository, resourceNumber, since);
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

  /**
   * Fetches a fresh GitHub App installation token via wsenv git-credentials get.
   * Mirrors the Lua auth.inject_github_token() logic in config/nginx.conf.
   */
  private static fetchInstallationToken(org: string): string | undefined {
    const result = spawnSync('/opt/sandboxd/sbin/wsenv', ['git-credentials', 'get'], {
      input: `protocol=https\nhost=github.com\npath=${org}/coworker-bot\n`,
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
      logger.warn(
        `GitHub: wsenv git-credentials get failed: ${result.stderr || result.error?.message}`
      );
      return undefined;
    }
    for (const line of (result.stdout as string).split('\n')) {
      const match = line.match(/^password=(.+)/);
      if (match) return match[1]!.trim();
    }
    logger.warn('GitHub: wsenv git-credentials get returned no password field');
    return undefined;
  }

  /**
   * Refreshes the installation token if it has expired (TTL: 55 minutes).
   * Called lazily on every API request via the tokenGetter closure in GitHubComments.
   */
  private refreshTokenIfNeeded(): void {
    if (this.token && Date.now() < this.tokenExpiry) return;
    const org = process.env.GITHUB_ORG;
    if (!org) return;
    const newToken = GitHubProvider.fetchInstallationToken(org);
    if (newToken) {
      this.token = newToken;
      this.tokenExpiry = Date.now() + GitHubProvider.TOKEN_TTL_MS;
      logger.debug('GitHub: installation token refreshed');
    } else {
      logger.warn('GitHub: failed to refresh installation token');
    }
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.webhook = undefined;
    this.poller = undefined;
    this.comments = undefined;
    this.token = undefined;
    this.tokenExpiry = 0;
  }
}
