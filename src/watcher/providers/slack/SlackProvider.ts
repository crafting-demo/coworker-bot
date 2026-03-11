import { BaseProvider } from '../BaseProvider.js';
import type { ProviderConfig, ProviderMetadata, EventHandler } from '../../types/index.js';
import { ConfigLoader } from '../../core/ConfigLoader.js';
import { SlackWebhook } from './SlackWebhook.js';
import { SlackComments } from './SlackComments.js';
import { SlackReactor } from './SlackReactor.js';
import { SlackPoller } from './SlackPoller.js';
import {
  normalizeWebhookEvent,
  normalizePolledMention,
  type SlackEventPayload,
} from './SlackNormalizer.js';
import { ProviderError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Slack provider that processes app_mention events.
 *
 * Unlike GitHub/GitLab/Linear, Slack only processes events where the bot is mentioned.
 * This prevents the bot from triggering on every message in high-traffic channels.
 *
 * Supports both webhook (real-time) and polling (fallback for missed mentions) modes.
 */
export class SlackProvider extends BaseProvider {
  private webhook: SlackWebhook | undefined;
  private comments: SlackComments | undefined;
  private poller: SlackPoller | undefined;
  private token: string | undefined;
  private botUsernames: string[] = [];
  private eventFilter: Set<string> = new Set(['app_mention']);

  get metadata(): ProviderMetadata {
    return {
      name: 'slack',
      version: '1.0.0',
    };
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    // Get OAuth token from config
    this.token = ConfigLoader.resolveSecret(
      config.auth?.token,
      config.auth?.tokenEnv,
      config.auth?.tokenFile
    );

    if (!this.token) {
      throw new ProviderError(
        'Slack bot token is required. Set SLACK_BOT_TOKEN environment variable or configure token/tokenFile in auth section. See docs/setup/slack.md for setup instructions.',
        'slack'
      );
    }

    // Validate token format (should start with xoxb- for bot tokens)
    if (!this.token.startsWith('xoxb-')) {
      logger.warn(
        'Slack token does not start with "xoxb-". Make sure you are using a Bot User OAuth Token, not a User OAuth Token or other token type.'
      );
    }

    // Initialize Slack API client
    this.comments = new SlackComments(this.token);

    // Get bot user ID for mention detection and deduplication.
    // Token detection runs first; an explicit botUsername in config/env overrides it.
    try {
      const botUserId = await this.comments.getBotUserId();
      this.botUsernames = [botUserId];
      logger.info(`Slack bot user ID auto-detected from token: ${botUserId}`);
      logger.info('Slack authentication successful');

      const override = config.options?.botUsername as string | undefined;
      if (override) {
        this.botUsernames = [override];
        logger.info(`Slack bot user ID overridden from config: ${override}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to authenticate with Slack API', { error: errorMessage });

      // Provide helpful error messages based on common issues
      if (errorMessage.includes('invalid_auth') || errorMessage.includes('not_authed')) {
        throw new ProviderError(
          'Slack authentication failed: Invalid bot token. Please verify your SLACK_BOT_TOKEN is correct. Token should start with "xoxb-" and be a valid Bot User OAuth Token from your Slack app.',
          'slack',
          error
        );
      } else if (errorMessage.includes('token_revoked')) {
        throw new ProviderError(
          'Slack authentication failed: Token has been revoked. Please generate a new Bot User OAuth Token in your Slack app settings.',
          'slack',
          error
        );
      } else if (errorMessage.includes('account_inactive')) {
        throw new ProviderError(
          'Slack authentication failed: Account is inactive. Please check your Slack workspace status.',
          'slack',
          error
        );
      } else {
        throw new ProviderError(
          `Slack authentication failed: ${errorMessage}. Please verify your bot token and network connectivity. See docs/setup/slack.md for setup instructions.`,
          'slack',
          error
        );
      }
    }

    // Initialize webhook handler
    const signingSecret = ConfigLoader.resolveSecret(
      config.options?.signingSecret as string | undefined,
      config.options?.signingSecretEnv as string | undefined,
      config.options?.signingSecretFile as string | undefined
    );

    this.webhook = new SlackWebhook(signingSecret);

    // Initialize poller if explicitly enabled
    // Unlike other providers, Slack polling is opt-in via pollingEnabled flag
    const pollingEnabled = config.options?.pollingEnabled as boolean | undefined;
    if (config.pollingInterval && pollingEnabled) {
      if (!this.botUsernames[0]) {
        throw new ProviderError(
          'Slack bot user ID is required for polling but was not set during initialization',
          'slack'
        );
      }
      const initialLookbackHours = (config.options?.initialLookbackHours as number) || 1;
      const botUserId = this.botUsernames[0];
      this.poller = new SlackPoller(this.token, botUserId, initialLookbackHours);
      logger.info('Slack polling enabled (fallback for missed mentions)');
    } else if (config.pollingInterval && !pollingEnabled) {
      logger.info(
        'Slack polling disabled (pollingEnabled=false). Set pollingEnabled=true to enable polling fallback.'
      );
    }

    const eventFilterConfig = config.options?.eventFilter as Record<string, unknown> | undefined;
    if (eventFilterConfig) {
      this.eventFilter = new Set(Object.keys(eventFilterConfig));
    }

    logger.info('Slack provider initialized');
  }

  async validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody?: string | Buffer
  ): Promise<boolean> {
    if (!this.webhook) {
      throw new ProviderError('Slack webhook not initialized', 'slack');
    }

    if (!rawBody) {
      throw new ProviderError('Raw body required for Slack signature verification', 'slack');
    }

    const result = this.webhook.validate(headers, body, rawBody);

    // Handle URL verification challenge
    if (result.challenge) {
      logger.info('Received Slack URL verification challenge');
      // The webhook handler should return the challenge
      // This is handled at the transport layer
    }

    return result.valid;
  }

  async handleWebhook(
    _headers: Record<string, string | string[] | undefined>,
    body: unknown,
    eventHandler: EventHandler
  ): Promise<void> {
    if (!this.webhook) {
      throw new ProviderError('Slack webhook not initialized', 'slack');
    }

    if (!this.comments) {
      throw new ProviderError('Slack comments not initialized', 'slack');
    }

    const payload = body as SlackEventPayload;

    // Handle URL verification challenge (webhook setup)
    if (payload.type === 'url_verification') {
      logger.debug('URL verification challenge handled by validateWebhook');
      return;
    }

    // Only process event_callback type (actual events)
    if (payload.type !== 'event_callback' || !payload.event) {
      logger.debug(`Ignoring Slack event type: ${payload.type}`);
      return;
    }

    const event = payload.event;

    if (!this.eventFilter.has(event.type)) {
      logger.debug(`Ignoring Slack event: ${event.type} - not in configured eventFilter`);
      return;
    }

    logger.debug(`Processing Slack app_mention in channel ${event.channel}`);

    // For threading:
    // - If event.thread_ts exists: reply in that existing thread
    // - If event.thread_ts is undefined: use event.ts to start/continue a thread
    const threadTs = event.thread_ts || event.ts;

    // Fetch thread history for context
    let history = '';
    try {
      history = await this.comments.getConversationHistory(event.channel, threadTs);
    } catch (error) {
      logger.warn('Failed to fetch Slack thread history', error);
    }

    const reactor = new SlackReactor(this.comments, event.channel, threadTs, this.botUsernames);

    // Normalize Slack event for template rendering
    const normalizedEvent = normalizeWebhookEvent(payload, history);

    await eventHandler(normalizedEvent, reactor);
  }

  async poll(eventHandler: EventHandler): Promise<void> {
    if (!this.poller) {
      logger.debug('Slack polling not configured');
      return;
    }

    if (!this.comments) {
      throw new ProviderError('Slack comments not initialized', 'slack');
    }

    try {
      const mentions = await this.poller.poll();

      if (mentions.length === 0) {
        logger.debug('No new Slack mentions found');
        return;
      }

      logger.info(`Processing ${mentions.length} Slack mentions from polling`);

      for (const mention of mentions) {
        logger.debug(`Processing polled mention in channel ${mention.channel}`);

        // For threading:
        // - If mention.threadTs exists: reply in that existing thread
        // - If mention.threadTs is undefined: use mention.ts to start/continue a thread
        const threadTs = mention.threadTs || mention.ts;

        // Fetch thread history for context
        let history = '';
        try {
          history = await this.comments.getConversationHistory(mention.channel, threadTs);
        } catch (error) {
          logger.warn('Failed to fetch Slack thread history', error);
        }

        const reactor = new SlackReactor(
          this.comments,
          mention.channel,
          threadTs,
          this.botUsernames
        );

        // Normalize polled mention for template rendering
        const normalizedEvent = normalizePolledMention(mention, history);

        await eventHandler(normalizedEvent, reactor);
      }
    } catch (error) {
      logger.error('Error polling Slack mentions', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.webhook = undefined;
    this.comments = undefined;
    this.poller = undefined;
    this.token = undefined;
    this.botUsernames = [];
  }
}
