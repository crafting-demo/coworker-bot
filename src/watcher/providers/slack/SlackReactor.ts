import type { Reactor, NormalizedEvent } from '../../types/index.js';
import type { SlackComments } from './SlackComments.js';
import { logger } from '../../utils/logger.js';

/**
 * Slack reactor for posting and updating messages in channels/threads.
 */
export class SlackReactor implements Reactor {
  constructor(
    private readonly comments: SlackComments,
    private readonly channel: string,
    private readonly threadTs: string | undefined,
    private readonly botUsernames: string[]
  ) {}

  async getLastComment(): Promise<{ author: string; body: string } | null> {
    try {
      const message = await this.comments.getLastMessage(this.channel, this.threadTs);

      if (!message) {
        logger.debug(`No messages found in Slack channel ${this.channel}`);
        return null;
      }

      logger.debug(`Last message in Slack channel ${this.channel}:`, {
        user: message.user,
        textPreview: message.text.substring(0, 100),
      });

      return {
        author: message.user,
        body: message.text,
      };
    } catch (error) {
      logger.error('Failed to get last message from Slack', error);
      throw error;
    }
  }

  /**
   * Enrich the normalized event with the full thread conversation history needed
   * for prompt rendering.  Called by the Watcher after the dedup check passes, so
   * the expensive conversations.replies fetch is skipped for duplicate events.
   */
  async enrichEvent(event: NormalizedEvent): Promise<void> {
    try {
      const history = await this.comments.getConversationHistory(this.channel, this.threadTs || '');
      if (history) {
        event.resource.description = history;
      }
    } catch (error) {
      logger.warn('Failed to enrich Slack event with conversation history', error);
      // Non-fatal: prompt will render with whatever context is already in the event
    }
  }

  async postComment(comment: string): Promise<string> {
    try {
      const ts = await this.comments.postMessage(this.channel, comment, this.threadTs);

      // Return composite ID: channel:ts
      return `${this.channel}:${ts}`;
    } catch (error) {
      logger.error('Failed to post message to Slack', error);
      throw error;
    }
  }

  isBotAuthor(author: string): boolean {
    return this.botUsernames.some((name) => name.toLowerCase() === author.toLowerCase());
  }
}
