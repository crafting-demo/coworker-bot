import { BaseProvider } from '../BaseProvider.js';
import type { ProviderConfig, ProviderMetadata, EventHandler } from '../../types/index.js';
import { ConfigLoader } from '../../core/ConfigLoader.js';
import { LinearWebhook } from './LinearWebhook.js';
import { LinearPoller } from './LinearPoller.js';
import { LinearComments } from './LinearComments.js';
import { LinearReactor } from './LinearReactor.js';
import {
  normalizeWebhookEvent,
  normalizePolledEvent,
  normalizeCommentEvent,
  type LinearWebhookPayload,
  type LinearCommentPayload,
} from './LinearNormalizer.js';
import { isBotMentionedInText, isBotAssignedInList } from '../../utils/eventFilter.js';
import { ProviderError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

type LinearEventConfig = { states: string[]; skipStates: string[] };

export class LinearProvider extends BaseProvider {
  private webhook: LinearWebhook | undefined;
  private poller: LinearPoller | undefined;
  private comments: LinearComments | undefined;
  private apiKey: string | undefined;
  private botUsernames: string[] = [];

  private static readonly DEFAULT_WEBHOOK_EVENTS: Record<string, LinearEventConfig> = {
    Issue: { states: ['all'], skipStates: ['done', 'cancelled', 'canceled'] },
    Comment: { states: ['all'], skipStates: ['done', 'cancelled', 'canceled'] },
  };

  private eventFilter: Record<string, LinearEventConfig> = {
    ...LinearProvider.DEFAULT_WEBHOOK_EVENTS,
  };

  get metadata(): ProviderMetadata {
    return {
      name: 'linear',
      version: '1.0.0',
    };
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    const modes: string[] = [];

    if (config.auth) {
      this.apiKey = ConfigLoader.resolveSecret(
        config.auth.token,
        config.auth.tokenEnv,
        config.auth.tokenFile
      );

      if (this.apiKey) {
        this.comments = new LinearComments(this.apiKey);
      }
    }

    const options = config.options as
      | {
          webhookSecret?: string;
          webhookSecretEnv?: string;
          webhookSecretFile?: string;
          teams?: string[];
          initialLookbackHours?: number;
          maxItemsPerPoll?: number;
          botUsername?: string | string[];
          eventFilter?: Record<string, { states?: string[]; skipStates?: string[] }>;
        }
      | undefined;

    // Read bot username(s) for deduplication — auto-detect from token if not configured
    if (options?.botUsername) {
      this.botUsernames = Array.isArray(options.botUsername)
        ? options.botUsername
        : [options.botUsername];
      logger.debug(`Linear bot usernames configured: ${this.botUsernames.join(', ')}`);
    } else if (this.comments) {
      const detected = await this.comments.getAuthenticatedUser();
      if (detected) {
        this.botUsernames = [detected];
        logger.info(`Linear bot username auto-detected from API key: ${detected}`);
      } else {
        logger.warn(
          'Linear: botUsername not configured and auto-detection failed - deduplication will not work'
        );
      }
    } else {
      logger.warn('Linear: No botUsername configured - deduplication will not work');
    }

    // Resolve webhook secret if provided
    const webhookSecret = ConfigLoader.resolveSecret(
      options?.webhookSecret,
      options?.webhookSecretEnv,
      options?.webhookSecretFile
    );

    this.webhook = new LinearWebhook(webhookSecret);
    modes.push('webhook');

    const hasPollingConfig = this.apiKey;

    if (hasPollingConfig) {
      const pollerConfig: {
        apiKey: string;
        teams?: string[];
        initialLookbackHours?: number;
        maxItemsPerPoll?: number;
      } = {
        apiKey: this.apiKey!,
      };

      if (options?.teams) {
        pollerConfig.teams = options.teams;
      }

      if (options?.initialLookbackHours !== undefined) {
        pollerConfig.initialLookbackHours = options.initialLookbackHours;
      }

      if (options?.maxItemsPerPoll !== undefined) {
        pollerConfig.maxItemsPerPoll = options.maxItemsPerPoll;
      }

      this.poller = new LinearPoller(pollerConfig);
      modes.push('polling');
    }

    if (options?.eventFilter) {
      const configured: Record<string, LinearEventConfig> = {};
      for (const [eventType, eventConfig] of Object.entries(options.eventFilter)) {
        const defaults = LinearProvider.DEFAULT_WEBHOOK_EVENTS[eventType];
        configured[eventType] = {
          states: eventConfig?.states ?? defaults?.states ?? ['all'],
          skipStates: eventConfig?.skipStates ?? defaults?.skipStates ?? [],
        };
      }
      this.eventFilter = configured;
    }
    logger.info(`Linear event filter: ${Object.keys(this.eventFilter).join(', ')}`);

    logger.info(`Linear provider initialized with modes: ${modes.join(', ')}`);
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
      throw new ProviderError('Linear webhook not initialized', 'linear');
    }

    if (!this.comments) {
      throw new ProviderError('Linear comments not initialized (API key required)', 'linear');
    }

    const { webhookId } = this.webhook.extractMetadata(headers);
    const payload = body as LinearWebhookPayload;

    logger.debug(`Processing Linear ${payload.type} event (${payload.action})`);

    const eventConfig = this.eventFilter[payload.type];
    if (!eventConfig) {
      logger.debug(`Skipping Linear ${payload.type} event - not in configured eventFilter`);
      return;
    }

    // Comment events: check parent issue state + bot mention
    if (payload.type === 'Comment') {
      const commentPayload = payload as unknown as LinearCommentPayload;
      const issueState = commentPayload.data.issue?.state?.name;
      if (
        issueState &&
        this.shouldSkipByState(issueState, eventConfig.states, eventConfig.skipStates)
      ) {
        logger.debug(`Skipping comment on completed/cancelled Linear issue`);
        return;
      }
      if (this.botUsernames.length === 0) {
        logger.error(`Skipping Linear comment - botUsername not configured`);
        return;
      }
      if (!isBotMentionedInText(commentPayload.data.body, this.botUsernames)) {
        logger.debug(`Skipping Linear comment - bot not mentioned`);
        return;
      }
      const issueId = commentPayload.data.issue.id;
      const reactor = new LinearReactor(this.comments, issueId, this.botUsernames);
      const normalizedEvent = normalizeCommentEvent(commentPayload, webhookId);
      await eventHandler(normalizedEvent, reactor);
      return;
    }

    // Issue events (default path): check state + bot assignment
    const issueId = payload.data.id;

    if (this.shouldSkipClosedItem(payload, eventConfig.states, eventConfig.skipStates)) {
      logger.debug(`Skipping completed/cancelled issue ${payload.data.identifier}`);
      return;
    }

    // Normalize first so we can inspect the assignees list
    const normalizedEvent = normalizeWebhookEvent(payload, webhookId);

    if (this.botUsernames.length === 0) {
      logger.error(`Skipping Linear issue ${payload.data.identifier} - botUsername not configured`);
      return;
    }
    if (
      !isBotAssignedInList(
        normalizedEvent.resource.assignees,
        this.botUsernames,
        (a) => (a as any).name
      )
    ) {
      logger.debug(`Skipping Linear issue ${payload.data.identifier} - bot not assigned`);
      return;
    }

    const reactor = new LinearReactor(this.comments, issueId, this.botUsernames);
    await eventHandler(normalizedEvent, reactor);
  }

  private shouldSkipByState(stateName: string, states: string[], skipStates: string[]): boolean {
    const lower = stateName.toLowerCase();
    // Allowlist check: skip if state not in allowlist (unless 'all' is present)
    if (!states.includes('all') && !states.includes(lower)) {
      return true;
    }
    // Denylist check
    if (skipStates.includes(lower)) {
      return true;
    }
    return false;
  }

  private shouldSkipClosedItem(
    payload: LinearWebhookPayload,
    states: string[],
    skipStates: string[]
  ): boolean {
    return this.shouldSkipByState(payload.data.state.name, states, skipStates);
  }

  private shouldSkipClosedPolledItem(item: any, states: string[], skipStates: string[]): boolean {
    return this.shouldSkipByState(item.data.state.name, states, skipStates);
  }

  async poll(eventHandler: EventHandler): Promise<void> {
    if (!this.poller) {
      throw new ProviderError('Linear poller not initialized', 'linear');
    }

    if (!this.comments) {
      throw new ProviderError('Linear comments not initialized (API key required)', 'linear');
    }

    const items = await this.poller.poll();

    logger.debug(`Processing ${items.length} items from Linear poll`);

    for (const item of items) {
      const issueId = item.data.id;

      const pollEventConfig = this.eventFilter['Issue'];
      if (!pollEventConfig) {
        logger.debug(`Skipping polled issue - not in configured eventFilter`);
        continue;
      }

      if (
        this.shouldSkipClosedPolledItem(item, pollEventConfig.states, pollEventConfig.skipStates)
      ) {
        logger.debug(`Skipping completed/cancelled issue ${item.data.identifier}`);
        continue;
      }

      // Normalize first so we can inspect the assignees list
      const normalizedEvent = normalizePolledEvent(item);

      if (this.botUsernames.length === 0) {
        logger.error(
          `Skipping polled Linear issue ${item.data.identifier} - botUsername not configured`
        );
        continue;
      }
      if (
        !isBotAssignedInList(
          normalizedEvent.resource.assignees,
          this.botUsernames,
          (a) => (a as any).name
        )
      ) {
        logger.debug(`Skipping polled Linear issue ${item.data.identifier} - bot not assigned`);
        continue;
      }

      logger.debug(`Creating reactor for issue ${item.data.identifier}`);

      const reactor = new LinearReactor(this.comments, issueId, this.botUsernames);

      logger.debug(`Calling event handler for issue ${item.data.identifier}`);
      await eventHandler(normalizedEvent, reactor);
    }

    logger.debug(`Finished processing ${items.length} items from Linear poll`);
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.webhook = undefined;
    this.poller = undefined;
    this.comments = undefined;
    this.apiKey = undefined;
  }
}
