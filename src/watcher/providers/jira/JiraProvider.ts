import { BaseProvider } from '../BaseProvider.js';
import type { ProviderConfig, ProviderMetadata, EventHandler } from '../../types/index.js';
import { ConfigLoader } from '../../core/ConfigLoader.js';
import { JiraWebhook } from './JiraWebhook.js';
import { JiraPoller } from './JiraPoller.js';
import { JiraComments } from './JiraComments.js';
import { JiraReactor } from './JiraReactor.js';
import {
  normalizeWebhookIssueEvent,
  normalizeWebhookCommentEvent,
  normalizePolledIssue,
  extractTextFromADF,
  type JiraWebhookPayload,
} from './JiraNormalizer.js';
import {
  isBotMentionedInText,
  isBotMentionedByAccountId,
  isBotAssignedInList,
} from '../../utils/eventFilter.js';
import { ProviderError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const ISSUE_EVENTS = new Set(['jira:issue_created', 'jira:issue_updated']);
const COMMENT_EVENTS = new Set(['comment_created', 'comment_updated']);

const DEFAULT_SKIP_STATUSES = ['done', 'closed', 'resolved', 'cancelled', "won't fix"];

export class JiraProvider extends BaseProvider {
  private webhook: JiraWebhook | undefined;
  private poller: JiraPoller | undefined;
  private comments: JiraComments | undefined;
  private authHeader: string | undefined;
  private botUsernames: string[] = [];
  private botAccountIds: string[] = [];
  private skipStatuses: string[] = DEFAULT_SKIP_STATUSES;

  get metadata(): ProviderMetadata {
    return {
      name: 'jira',
      version: '1.0.0',
    };
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    const modes: string[] = [];

    const options = config.options as
      | {
          baseUrl?: string;
          webhookSecret?: string;
          webhookSecretEnv?: string;
          webhookSecretFile?: string;
          botUsername?: string | string[];
          projects?: string[];
          initialLookbackHours?: number;
          maxItemsPerPoll?: number;
          skipStatuses?: string[];
        }
      | undefined;

    // Resolve base URL — options.baseUrl takes precedence over JIRA_BASE_URL env var
    const baseUrl = (options?.baseUrl ?? process.env.JIRA_BASE_URL ?? '').replace(/\/$/, '');
    if (!baseUrl) {
      throw new ProviderError(
        'Jira baseUrl is required. Set options.baseUrl in config or the JIRA_BASE_URL environment variable.',
        'jira'
      );
    }

    // Build the Authorization header from the configured auth method
    if (config.auth) {
      if (config.auth.type === 'basic') {
        // Jira Cloud: email + API token → Basic base64(email:token)
        const email = config.auth.username ?? process.env.JIRA_EMAIL;
        const token = ConfigLoader.resolveSecret(
          config.auth.token,
          config.auth.tokenEnv,
          config.auth.tokenFile
        );
        if (email && token) {
          this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
        }
      } else if (config.auth.type === 'token') {
        // Jira Server/DC or Jira Cloud: Personal Access Token → Bearer token
        const token = ConfigLoader.resolveSecret(
          config.auth.token,
          config.auth.tokenEnv,
          config.auth.tokenFile
        );
        if (token) {
          this.authHeader = `Bearer ${token}`;
        }
      }
    }

    if (!this.authHeader) {
      throw new ProviderError(
        'Jira auth is required. Use auth.type=basic with a username (email) and tokenEnv for Jira Cloud, ' +
          'or auth.type=token with a Personal Access Token for Jira Server/DC.',
        'jira'
      );
    }

    this.comments = new JiraComments(baseUrl, this.authHeader);

    // Resolve bot username(s) for deduplication; auto-detect from credentials if absent.
    // Always fetch the authenticated user to get the account ID, which is needed to detect
    // wiki markup mentions ([~accountid:...]) in addition to ADF @displayName mentions.
    if (options?.botUsername) {
      this.botUsernames = Array.isArray(options.botUsername)
        ? options.botUsername
        : [options.botUsername];
      logger.debug(`Jira bot usernames configured: ${this.botUsernames.join(', ')}`);
    }
    const detected = await this.comments.getAuthenticatedUser();
    if (detected) {
      if (this.botUsernames.length === 0) {
        this.botUsernames = [detected.displayName];
        logger.info(`Jira bot username auto-detected: ${detected.displayName}`);
      }
      this.botAccountIds = [detected.accountId];
      logger.debug(`Jira bot account ID: ${detected.accountId}`);
    } else if (this.botUsernames.length === 0) {
      logger.warn(
        'Jira: botUsername not configured and auto-detection failed - comment mention detection will not work'
      );
    }

    // Resolve optional webhook secret
    const webhookSecret = ConfigLoader.resolveSecret(
      options?.webhookSecret,
      options?.webhookSecretEnv,
      options?.webhookSecretFile
    );

    this.webhook = new JiraWebhook(webhookSecret);
    modes.push('webhook');

    // Configure which issue statuses to skip
    if (options?.skipStatuses) {
      this.skipStatuses = options.skipStatuses.map((s) => s.toLowerCase());
    }

    // Set up poller
    const pollerConfig: {
      baseUrl: string;
      authHeader: string;
      projects?: string[];
      initialLookbackHours?: number;
      maxItemsPerPoll?: number;
    } = { baseUrl, authHeader: this.authHeader };

    if (options?.projects) pollerConfig.projects = options.projects;
    if (options?.initialLookbackHours !== undefined)
      pollerConfig.initialLookbackHours = options.initialLookbackHours;
    if (options?.maxItemsPerPoll !== undefined)
      pollerConfig.maxItemsPerPoll = options.maxItemsPerPoll;

    this.poller = new JiraPoller(pollerConfig);
    modes.push('polling');

    logger.info(`Jira provider initialized with modes: ${modes.join(', ')}`);
    logger.info(`Jira base URL: ${baseUrl}`);
  }

  async validateWebhook(
    headers: Record<string, string | string[] | undefined>,
    _body: unknown,
    rawBody?: string | Buffer
  ): Promise<boolean> {
    if (!this.webhook) {
      return false;
    }

    const result = this.webhook.validate(headers, rawBody ?? '');
    return result.valid;
  }

  async handleWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    eventHandler: EventHandler
  ): Promise<void> {
    if (!this.webhook) {
      throw new ProviderError('Jira webhook not initialized', 'jira');
    }

    if (!this.comments) {
      throw new ProviderError('Jira comments not initialized', 'jira');
    }

    const { deliveryId } = this.webhook.extractMetadata(headers);
    const payload = body as JiraWebhookPayload;

    logger.debug(`Processing Jira webhook event: ${payload.webhookEvent}`);

    if (!payload.issue) {
      logger.debug(`Skipping Jira webhook - no issue in payload`);
      return;
    }

    // status may be absent in the minimal issue stub sent with comment webhook payloads
    const issueStatus = payload.issue.fields.status?.name.toLowerCase() ?? '';

    // ── Comment events ────────────────────────────────────────────────────────
    if (COMMENT_EVENTS.has(payload.webhookEvent)) {
      if (!payload.comment) {
        logger.debug('Skipping Jira comment event - no comment in payload');
        return;
      }

      if (this.skipStatuses.includes(issueStatus)) {
        logger.debug(`Skipping comment on closed/done Jira issue ${payload.issue.key}`);
        return;
      }

      if (this.botUsernames.length === 0 && this.botAccountIds.length === 0) {
        logger.error('Skipping Jira comment - botUsername not configured');
        return;
      }

      const commentText = extractTextFromADF(payload.comment.body);
      if (
        !isBotMentionedInText(commentText, this.botUsernames) &&
        !isBotMentionedByAccountId(commentText, this.botAccountIds)
      ) {
        logger.debug(
          `Skipping Jira comment - bot not mentioned. ` +
            `Extracted text: ${JSON.stringify(commentText.slice(0, 200))}, ` +
            `Bot usernames: ${JSON.stringify(this.botUsernames)}, ` +
            `Bot account IDs: ${JSON.stringify(this.botAccountIds)}`
        );
        return;
      }

      const normalizedEvent = normalizeWebhookCommentEvent(payload, deliveryId);
      const reactor = new JiraReactor(this.comments, payload.issue.key, this.botUsernames);
      await eventHandler(normalizedEvent, reactor);
      return;
    }

    // ── Issue events ──────────────────────────────────────────────────────────
    if (ISSUE_EVENTS.has(payload.webhookEvent)) {
      if (this.skipStatuses.includes(issueStatus)) {
        logger.debug(`Skipping closed/done Jira issue ${payload.issue.key}`);
        return;
      }

      const normalizedEvent = normalizeWebhookIssueEvent(payload, deliveryId);

      if (this.botUsernames.length === 0) {
        logger.error(`Skipping Jira issue ${payload.issue.key} - botUsername not configured`);
        return;
      }

      if (
        !isBotAssignedInList(
          normalizedEvent.resource.assignees,
          this.botUsernames,
          (a) => (a as { displayName: string }).displayName
        )
      ) {
        logger.debug(`Skipping Jira issue ${payload.issue.key} - bot not assigned`);
        return;
      }

      const reactor = new JiraReactor(this.comments, payload.issue.key, this.botUsernames);
      await eventHandler(normalizedEvent, reactor);
      return;
    }

    logger.debug(`Skipping unhandled Jira webhook event: ${payload.webhookEvent}`);
  }

  async poll(eventHandler: EventHandler): Promise<void> {
    if (!this.poller) {
      throw new ProviderError('Jira poller not initialized', 'jira');
    }

    if (!this.comments) {
      throw new ProviderError('Jira comments not initialized', 'jira');
    }

    const issues = await this.poller.poll();

    logger.debug(`Processing ${issues.length} issues from Jira poll`);

    for (const issue of issues) {
      const issueStatus = issue.fields.status?.name.toLowerCase() ?? '';

      if (this.skipStatuses.includes(issueStatus)) {
        logger.debug(`Skipping closed/done Jira issue ${issue.key}`);
        continue;
      }

      const normalizedEvent = normalizePolledIssue(issue);

      if (this.botUsernames.length === 0) {
        logger.error(`Skipping polled Jira issue ${issue.key} - botUsername not configured`);
        continue;
      }

      if (
        !isBotAssignedInList(
          normalizedEvent.resource.assignees,
          this.botUsernames,
          (a) => (a as { displayName: string }).displayName
        )
      ) {
        logger.debug(`Skipping polled Jira issue ${issue.key} - bot not assigned`);
        continue;
      }

      const reactor = new JiraReactor(this.comments, issue.key, this.botUsernames);
      await eventHandler(normalizedEvent, reactor);
    }

    logger.debug(`Finished processing ${issues.length} issues from Jira poll`);
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.webhook = undefined;
    this.poller = undefined;
    this.comments = undefined;
    this.authHeader = undefined;
  }
}
