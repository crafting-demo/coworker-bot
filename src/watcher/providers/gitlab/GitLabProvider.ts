import { BaseProvider } from '../BaseProvider.js';
import type {
  ProviderConfig,
  ProviderMetadata,
  EventHandler,
  NormalizedEvent,
} from '../../types/index.js';
// NormalizedEvent used in shouldProcessEvent signature
import { ConfigLoader } from '../../core/ConfigLoader.js';
import { GitLabWebhook } from './GitLabWebhook.js';
import { GitLabPoller } from './GitLabPoller.js';
import { GitLabComments } from './GitLabComments.js';
import { GitLabReactor } from './GitLabReactor.js';
import {
  normalizeWebhookEvent,
  normalizePolledEvent,
  type GitLabWebhookPayload,
} from './GitLabNormalizer.js';
import { isBotMentionedInText, isBotAssignedInList } from '../../utils/eventFilter.js';
import { ProviderError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

type GitLabEventConfig = { actions: string[]; skipActions: string[] };

export class GitLabProvider extends BaseProvider {
  private webhook: GitLabWebhook | undefined;
  private poller: GitLabPoller | undefined;
  private comments: GitLabComments | undefined;
  private token: string | undefined;
  private botUsernames: string[] = [];
  private baseUrl: string | undefined;

  private static readonly DEFAULT_WEBHOOK_EVENTS: Record<string, GitLabEventConfig> = {
    issue: { actions: ['all'], skipActions: ['open'] },
    merge_request: { actions: ['all'], skipActions: ['open', 'update'] },
    note: { actions: ['all'], skipActions: [] },
  };

  private eventFilter: Record<string, GitLabEventConfig> = {
    ...GitLabProvider.DEFAULT_WEBHOOK_EVENTS,
  };

  get metadata(): ProviderMetadata {
    return {
      name: 'gitlab',
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
        const options = config.options as
          | {
              baseUrl?: string;
            }
          | undefined;

        this.baseUrl = options?.baseUrl;
        this.comments = new GitLabComments(this.token, this.baseUrl);
      }
    }

    const options = config.options as
      | {
          webhookToken?: string;
          webhookTokenEnv?: string;
          webhookTokenFile?: string;
          baseUrl?: string;
          projects?: string[];
          initialLookbackHours?: number;
          maxItemsPerPoll?: number;
          botUsername?: string | string[];
          eventFilter?: Record<string, { actions?: string[]; skipActions?: string[] }>;
        }
      | undefined;

    // Read bot username(s) for deduplication — auto-detect from token if not configured
    if (options?.botUsername) {
      this.botUsernames = Array.isArray(options.botUsername)
        ? options.botUsername
        : [options.botUsername];
      logger.debug(`GitLab bot usernames configured: ${this.botUsernames.join(', ')}`);
    } else if (this.comments) {
      const detected = await this.comments.getAuthenticatedUser();
      if (detected) {
        this.botUsernames = [detected];
        logger.info(`GitLab bot username auto-detected from token: ${detected}`);
      } else {
        logger.warn(
          'GitLab: botUsername not configured and auto-detection failed - deduplication will not work'
        );
      }
    } else {
      logger.warn('GitLab: No botUsername configured - deduplication will not work');
    }

    // Resolve webhook token if provided
    const webhookToken = ConfigLoader.resolveSecret(
      options?.webhookToken,
      options?.webhookTokenEnv,
      options?.webhookTokenFile
    );

    this.webhook = new GitLabWebhook(webhookToken);
    modes.push('webhook');

    if (options?.eventFilter) {
      const configured: Record<string, GitLabEventConfig> = {};
      for (const [eventType, eventConfig] of Object.entries(options.eventFilter)) {
        const defaults = GitLabProvider.DEFAULT_WEBHOOK_EVENTS[eventType];
        configured[eventType] = {
          actions: eventConfig?.actions ?? defaults?.actions ?? ['all'],
          skipActions: eventConfig?.skipActions ?? defaults?.skipActions ?? [],
        };
      }
      this.eventFilter = configured;
    }
    logger.info(`GitLab event filter: ${Object.keys(this.eventFilter).join(', ')}`);

    const hasPollingConfig = this.token && options?.projects && options.projects.length > 0;

    if (hasPollingConfig) {
      const pollerConfig: {
        token: string;
        projects: string[];
        events: string[];
        initialLookbackHours?: number;
        maxItemsPerPoll?: number;
        baseUrl?: string;
      } = {
        token: this.token!,
        projects: options!.projects!,
        events: Object.keys(this.eventFilter),
      };

      if (options!.initialLookbackHours !== undefined) {
        pollerConfig.initialLookbackHours = options.initialLookbackHours;
      }

      if (options!.maxItemsPerPoll !== undefined) {
        pollerConfig.maxItemsPerPoll = options.maxItemsPerPoll;
      }

      if (this.baseUrl) {
        pollerConfig.baseUrl = this.baseUrl;
      }

      this.poller = new GitLabPoller(pollerConfig);
      modes.push('polling');
    }

    logger.info(`GitLab provider initialized with modes: ${modes.join(', ')}`);
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
      throw new ProviderError('GitLab webhook not initialized', 'gitlab');
    }

    if (!this.comments) {
      throw new ProviderError('GitLab comments not initialized (token required)', 'gitlab');
    }

    const { event } = this.webhook.extractMetadata(headers);
    const payload = body as GitLabWebhookPayload;

    logger.debug(`Processing GitLab ${event} event`);

    const eventConfig = this.eventFilter[payload.object_kind];
    if (!eventConfig) {
      logger.debug(`Skipping GitLab ${payload.object_kind} event - not in configured eventFilter`);
      return;
    }

    // Determine resource type and number for reactor
    let resourceType: string;
    let resourceNumber: number;

    if (payload.object_kind === 'issue') {
      resourceType = 'issue';
      resourceNumber = (payload.object_attributes as { iid: number }).iid;
    } else if (payload.object_kind === 'merge_request') {
      resourceType = 'merge_request';
      resourceNumber = (payload.object_attributes as { iid: number }).iid;
    } else if (payload.object_kind === 'note') {
      // Note events are comments - these should be processed
      // Determine if it's on an issue or MR
      const notePayload = payload as any;
      if (notePayload.merge_request) {
        resourceType = 'merge_request';
        resourceNumber = notePayload.merge_request.iid;
      } else if (notePayload.issue) {
        resourceType = 'issue';
        resourceNumber = notePayload.issue.iid;
      } else {
        logger.debug(`Skipping note event - unable to determine resource type`);
        return;
      }
    } else {
      logger.debug(`Unsupported GitLab event type: ${payload.object_kind}`);
      return;
    }

    const projectId = payload.project.path_with_namespace;

    // Normalize event first to apply shared filtering logic
    const normalizedEvent = normalizeWebhookEvent(payload);

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

    // Create reactor and process event
    const reactor = new GitLabReactor(
      this.comments,
      projectId,
      resourceType,
      resourceNumber,
      this.botUsernames
    );

    await eventHandler(normalizedEvent, reactor);
  }

  private shouldProcessEvent(
    event: NormalizedEvent,
    hasRecentNotes?: boolean,
    actions: string[] = ['all'],
    skipActions: string[] = []
  ): boolean {
    const { type, action, resource } = event;

    // Allowlist check
    if (!actions.includes('all') && !actions.includes(action)) {
      logger.debug(
        `Skipping ${type} !${resource.number} ${action} event - not in actions allowlist`
      );
      return false;
    }

    // Denylist check
    if (skipActions.includes(action)) {
      logger.debug(`Skipping ${type} !${resource.number} ${action} event`);
      return false;
    }

    // Assignment/mention filter: only process if bot is involved
    if (this.botUsernames.length === 0) {
      logger.error(`Skipping ${type} !${resource.number} - botUsername not configured`);
      return false;
    }
    if (resource.comment) {
      if (!isBotMentionedInText(resource.comment.body, this.botUsernames)) {
        logger.debug(`Skipping ${type} !${resource.number} comment - bot not mentioned`);
        return false;
      }
    } else {
      if (!isBotAssignedInList(resource.assignees, this.botUsernames, (a) => (a as any).username)) {
        logger.debug(`Skipping ${type} !${resource.number} - bot not assigned`);
        return false;
      }
    }

    // For polled events, skip if no recent human interaction
    if (type === 'merge_request' && action === 'poll' && hasRecentNotes === false) {
      logger.debug(
        `Skipping polled MR !${resource.number} - only updated due to commits, no new notes`
      );
      return false;
    }

    // Skip closed/merged items unless they're being reopened
    if (resource.state === 'closed' && action !== 'reopen') {
      logger.debug(`Skipping closed/merged ${type} !${resource.number}`);
      return false;
    }

    return true;
  }

  /**
   * Check if an MR has recent human interaction (notes/comments)
   * This helps filter out MRs that were only updated due to commits
   */
  private async hasRecentHumanInteraction(projectId: string, mrNumber: number): Promise<boolean> {
    if (!this.comments) {
      return true; // If we can't check, assume there is interaction
    }

    try {
      // Check for recent notes (last 5 notes)
      const notes = await this.comments.listNotes(projectId, mrNumber, 5);

      // If there are any notes, consider it as having interaction
      // The deduplication system will handle if the bot already commented
      if (notes.length > 0) {
        logger.debug(`MR !${mrNumber} has ${notes.length} recent note(s)`);
        return true;
      }

      logger.debug(`MR !${mrNumber} has no recent notes`);
      return false;
    } catch (error) {
      logger.warn(`Failed to check notes for MR !${mrNumber}`, error);
      // On error, assume there is interaction to avoid missing important events
      return true;
    }
  }

  async poll(eventHandler: EventHandler): Promise<void> {
    if (!this.poller) {
      throw new ProviderError('GitLab poller not initialized', 'gitlab');
    }

    if (!this.comments) {
      throw new ProviderError('GitLab comments not initialized (token required)', 'gitlab');
    }

    const items = await this.poller.poll();

    logger.debug(`Processing ${items.length} items from GitLab poll`);

    for (const item of items) {
      const projectId = item.project;
      const resourceType = item.type === 'issue' ? 'issue' : 'merge_request';
      const resourceNumber = item.number;

      const pollEventConfig = this.eventFilter[item.type];
      if (!pollEventConfig) {
        logger.debug(`Skipping polled ${item.type} - not in configured eventFilter`);
        continue;
      }

      // For MRs, check if there are recent notes to distinguish
      // between commit updates (skip) vs human interaction (process)
      let hasRecentNotes: boolean | undefined;
      if (resourceType === 'merge_request') {
        hasRecentNotes = await this.hasRecentHumanInteraction(projectId, resourceNumber);
      }

      // Normalize event first to apply shared filtering logic
      const normalizedEvent = normalizePolledEvent(item);

      // Apply shared filtering logic (same as webhooks)
      if (
        !this.shouldProcessEvent(
          normalizedEvent,
          hasRecentNotes,
          pollEventConfig.actions,
          pollEventConfig.skipActions
        )
      ) {
        continue; // Event filtered out (already logged in shouldProcessEvent)
      }

      logger.debug(`Creating reactor for ${resourceType} !${resourceNumber} in ${projectId}`);

      const reactor = new GitLabReactor(
        this.comments,
        projectId,
        resourceType,
        resourceNumber,
        this.botUsernames
      );

      logger.debug(`Calling event handler for ${resourceType} !${resourceNumber}`);
      await eventHandler(normalizedEvent, reactor);
    }

    logger.debug(`Finished processing ${items.length} items from GitLab poll`);
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.webhook = undefined;
    this.poller = undefined;
    this.comments = undefined;
    this.token = undefined;
  }
}
