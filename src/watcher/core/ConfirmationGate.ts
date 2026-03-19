import { randomUUID } from 'crypto';
import type { NormalizedEvent, Reactor } from '../types/index.js';
import type { ConfirmationConfig } from '../types/config.js';
import { SlackComments } from '../providers/slack/SlackComments.js';
import { SlackWebhook } from '../providers/slack/SlackWebhook.js';
import { logger } from '../utils/logger.js';

interface PendingEvent {
  id: string;
  event: NormalizedEvent;
  reactor: Reactor;
  execute: () => Promise<unknown>;
  channel: string;
  messageTs: string;
  threadTs: string;
  expiresAt: number;
}

interface SlackThread {
  channel: string;
  threadTs: string;
}

// GitHub/GitLab URL: https://github.com/owner/repo/pull/123 or /issues/123
const GITHUB_URL_RE =
  /https?:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)/g;
const GITLAB_URL_RE =
  /https?:\/\/[^/]+\/([^/]+(?:\/[^/]+)+)\/-\/(?:merge_requests|issues)\/(\d+)/g;

// Short reference: owner/repo#123  (requires at least one slash before #)
const SHORT_REF_RE = /(?:^|[\s(])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)/g;

/**
 * Parse a text string for GitHub/GitLab resource references.
 * Returns an array of resource keys like "owner/repo:pull_request:123".
 *
 * Recognised patterns:
 *   - https://github.com/owner/repo/pull/123
 *   - https://github.com/owner/repo/issues/123
 *   - https://gitlab.example.com/group/project/-/merge_requests/123
 *   - owner/repo#123
 */
export function parseResourceReferences(text: string): string[] {
  const keys = new Set<string>();

  for (const m of text.matchAll(GITHUB_URL_RE)) {
    const repo = m[1];
    const number = m[2];
    const type = m[0].includes('/pull/') ? 'pull_request' : 'issue';
    keys.add(`${repo}:${type}:${number}`);
  }

  for (const m of text.matchAll(GITLAB_URL_RE)) {
    const project = m[1];
    const number = m[2];
    const type = m[0].includes('/merge_requests/') ? 'merge_request' : 'issue';
    keys.add(`${project}:${type}:${number}`);
  }

  for (const m of text.matchAll(SHORT_REF_RE)) {
    const repo = m[1];
    const number = m[2];
    // Short refs are ambiguous (could be issue or PR), register both
    keys.add(`${repo}:pull_request:${number}`);
    keys.add(`${repo}:issue:${number}`);
  }

  return [...keys];
}

/**
 * Gates event execution behind a Slack interactive confirmation.
 *
 * When an event passes all provider filters and deduplication, instead of
 * immediately executing the command, ConfirmationGate posts a Slack message
 * with "Address it" / "Skip" buttons. The command only runs if a user clicks
 * "Address it". Unconfirmed events expire after a configurable timeout.
 *
 * Thread mapping:
 * - When a Slack event is processed (not gated), the Watcher calls
 *   registerThread() to associate the Slack thread with any GitHub/GitLab
 *   resource references found in the message text.
 * - When a GitHub/GitLab event later arrives through the gate, the
 *   confirmation is posted to the originating Slack thread.
 * - If no thread is registered, the fallback channel from config is used.
 */
export class ConfirmationGate {
  private pendingEvents: Map<string, PendingEvent> = new Map();
  private threadMap: Map<string, SlackThread> = new Map();
  private slackComments: SlackComments;
  private slackWebhook: SlackWebhook;
  private fallbackChannel: string | undefined;
  private timeoutMs: number;
  private cleanupInterval: NodeJS.Timeout | undefined;

  constructor(config: ConfirmationConfig, slackComments: SlackComments, slackWebhook: SlackWebhook) {
    this.slackComments = slackComments;
    this.slackWebhook = slackWebhook;
    this.fallbackChannel = config.channel;
    this.timeoutMs = (config.timeoutMinutes ?? 30) * 60 * 1000;

    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60_000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }

    logger.info(
      `Confirmation gate enabled (fallback channel: ${this.fallbackChannel ?? 'none'}, timeout: ${config.timeoutMinutes ?? 30}m)`
    );
  }

  /**
   * Stable key that identifies a resource across multiple events.
   * All comments on PR #123 share the same key → same Slack thread.
   */
  private resourceKey(event: NormalizedEvent): string {
    return `${event.resource.repository}:${event.type}:${event.resource.number}`;
  }

  /**
   * Register a Slack thread for a resource key so that future confirmations
   * for this resource are posted to that thread instead of the fallback channel.
   *
   * Called by the Watcher when processing Slack events that reference
   * GitHub/GitLab resources in their message text.
   */
  registerThread(resourceKey: string, channel: string, threadTs: string): void {
    this.threadMap.set(resourceKey, { channel, threadTs });
    logger.debug(`Registered Slack thread for ${resourceKey} → ${channel}:${threadTs}`);
  }

  /**
   * Enqueue an event for confirmation. Posts a Slack Block Kit message
   * and stores the event for later execution.
   *
   * Thread resolution order:
   *   1. Pre-registered thread (from a prior Slack event that referenced this resource)
   *   2. Thread created by a previous confirmation for the same resource
   *   3. New top-level message in the fallback channel
   */
  async enqueue(
    event: NormalizedEvent,
    reactor: Reactor,
    execute: () => Promise<unknown>
  ): Promise<void> {
    const resKey = this.resourceKey(event);

    // Skip if there's already a pending confirmation for this resource.
    // Without this check, each poll cycle would re-trigger a new confirmation
    // because no dedup comment has been posted on the PR yet.
    for (const pending of this.pendingEvents.values()) {
      if (this.resourceKey(pending.event) === resKey) {
        logger.debug(`Skipping duplicate confirmation for ${resKey} (already pending: ${pending.id})`);
        return;
      }
    }

    const pendingId = randomUUID();
    const existingThread = this.threadMap.get(resKey);

    const channel = existingThread?.channel ?? this.fallbackChannel;
    if (!channel) {
      logger.info(
        `No Slack thread registered for ${resKey} and no fallback channel configured — ignoring event`
      );
      return;
    }

    const blocks = this.buildBlocks(event, pendingId);
    const fallbackText = this.buildFallbackText(event);

    const messageTs = await this.slackComments.postBlockMessage(
      channel,
      fallbackText,
      blocks,
      existingThread?.threadTs
    );

    // The first message for a resource becomes the thread parent
    const threadTs = existingThread?.threadTs ?? messageTs;
    if (!existingThread) {
      this.threadMap.set(resKey, { channel, threadTs });
    }

    this.pendingEvents.set(pendingId, {
      id: pendingId,
      event,
      reactor,
      execute,
      channel,
      messageTs,
      threadTs,
      expiresAt: Date.now() + this.timeoutMs,
    });

    logger.info(
      `Confirmation requested for ${resKey} in ${channel}:${threadTs} (pending: ${pendingId})`
    );
  }

  /**
   * Handle a Slack interaction payload (button click).
   * Called by the webhook server when Slack posts to the interactions endpoint.
   */
  async handleInteraction(
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>,
    rawBody: string | Buffer
  ): Promise<{ ok: boolean; error?: string }> {
    const validation = this.slackWebhook.validate(headers, body, rawBody);
    if (!validation.valid) {
      logger.warn(`Confirmation interaction signature invalid: ${validation.error}`);
      return { ok: false, error: validation.error ?? 'Signature verification failed' };
    }

    let payload: Record<string, unknown>;
    try {
      const payloadStr =
        typeof body.payload === 'string'
          ? body.payload
          : this.extractPayloadFromRaw(rawBody);
      if (!payloadStr) {
        return { ok: false, error: 'Missing payload field' };
      }
      payload = JSON.parse(payloadStr);
    } catch {
      return { ok: false, error: 'Invalid payload JSON' };
    }

    const actions = payload.actions as unknown[] | undefined;
    if (payload.type !== 'block_actions' || !Array.isArray(actions) || actions.length === 0) {
      logger.debug(`Ignoring non-block_actions interaction type: ${String(payload.type)}`);
      return { ok: true };
    }

    const action = actions[0] as Record<string, unknown>;
    const pendingId = String(action.value ?? '');
    const actionId = String(action.action_id ?? '');
    const user = payload.user as Record<string, unknown> | undefined;
    const userName = String(user?.username || user?.name || 'unknown');

    const pending = this.pendingEvents.get(pendingId);
    if (!pending) {
      logger.debug(`Interaction for unknown/expired pending ID: ${pendingId}`);
      return { ok: true };
    }

    const resKey = this.resourceKey(pending.event);

    if (actionId === 'confirmation_approve') {
      logger.info(`Confirmation approved by ${userName} for ${resKey}`);
      this.pendingEvents.delete(pendingId);
      await this.updateMessageStatus(pending, `Approved by ${userName}`);

      try {
        await pending.execute();
      } catch (error) {
        logger.error(`Error executing approved event for ${resKey}`, error);
      }
    } else if (actionId === 'confirmation_skip') {
      logger.info(`Confirmation skipped by ${userName} for ${resKey}`);
      this.pendingEvents.delete(pendingId);
      await this.updateMessageStatus(pending, `Skipped by ${userName}`);
    }

    return { ok: true };
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.pendingEvents.clear();
    this.threadMap.clear();
    logger.debug('Confirmation gate shut down');
  }

  get pendingCount(): number {
    return this.pendingEvents.size;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildBlocks(event: NormalizedEvent, pendingId: string): unknown[] {
    const resourceLink = event.resource.url
      ? `<${event.resource.url}|${event.resource.repository}#${event.resource.number}>`
      : `${event.resource.repository}#${event.resource.number}`;

    let text: string;
    if (event.resource.comment) {
      const author = event.resource.comment.author || event.actor.username;
      const body = event.resource.comment.body || '';
      const truncated = body.length > 300 ? body.substring(0, 300) + '…' : body;
      const quoted = truncated.replace(/\n/g, '\n>');
      text = `*New comment on ${resourceLink}*\nBy *${author}*:\n>${quoted}`;
    } else {
      text = `*New activity on ${resourceLink}*\n*${event.resource.title}*\nAction: \`${event.action}\``;
    }

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
      {
        type: 'actions',
        block_id: `confirmation_${pendingId}`,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Address it', emoji: true },
            style: 'primary',
            action_id: 'confirmation_approve',
            value: pendingId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Skip', emoji: true },
            action_id: 'confirmation_skip',
            value: pendingId,
          },
        ],
      },
    ];
  }

  private buildFallbackText(event: NormalizedEvent): string {
    const res = event.resource;
    if (res.comment) {
      const author = res.comment.author || event.actor.username;
      return `New comment on ${res.repository}#${res.number} by ${author}`;
    }
    return `New activity on ${res.repository}#${res.number}: ${res.title}`;
  }

  private async updateMessageStatus(pending: PendingEvent, status: string): Promise<void> {
    try {
      const { repository, number } = pending.event.resource;
      const text = `~${repository}#${number}~ — _${status}_`;
      await this.slackComments.updateMessage(pending.channel, pending.messageTs, text);
    } catch (error) {
      logger.warn('Failed to update confirmation message status', error);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, pending] of this.pendingEvents) {
      if (pending.expiresAt <= now) {
        const resKey = this.resourceKey(pending.event);
        logger.info(`Confirmation expired for ${resKey} (pending: ${id})`);
        this.pendingEvents.delete(id);
        this.updateMessageStatus(pending, 'Expired (timed out)').catch(() => {});
      }
    }
  }

  private extractPayloadFromRaw(rawBody: string | Buffer): string | null {
    const str = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const params = new URLSearchParams(str);
    return params.get('payload');
  }
}
