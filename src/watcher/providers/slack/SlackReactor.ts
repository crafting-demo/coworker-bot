import type { Reactor, NormalizedEvent } from '../../types/index.js';
import type { SlackComments, SlackMessage } from './SlackComments.js';
import { logger } from '../../utils/logger.js';

/**
 * Slack reactor for posting and updating messages in channels/threads.
 */
export class SlackReactor implements Reactor {
  /**
   * Cached result of getMessages() — populated during the dedup check so that
   * enrichEvent() can reuse it without a second conversations.replies API call.
   */
  private cachedMessages?: SlackMessage[];

  constructor(
    private readonly comments: SlackComments,
    private readonly channel: string,
    private readonly threadTs: string | undefined,
    private readonly botUsernames: string[]
  ) {}

  async getLastComment(): Promise<{ author: string; body: string } | null> {
    try {
      const messages = await this.comments.getMessages(this.channel, this.threadTs || '');
      // Cache so enrichEvent() can format the history without a second API call
      this.cachedMessages = messages;

      if (messages.length === 0) {
        logger.debug(`No messages found in Slack channel ${this.channel}`);
        return null;
      }

      const lastMessage = messages[messages.length - 1]!;

      logger.debug(`Last message in Slack channel ${this.channel}:`, {
        user: lastMessage.user,
        textPreview: lastMessage.text.substring(0, 100),
      });

      return {
        author: lastMessage.user,
        body: lastMessage.text,
      };
    } catch (error) {
      logger.error('Failed to get last message from Slack', error);
      throw error;
    }
  }

  /**
   * Enrich the normalized event with the full thread conversation history needed
   * for prompt rendering.  Uses the cached getMessages() result from the preceding
   * dedup check, so conversations.replies is called at most once per event.
   * Called by the Watcher after the dedup check passes, so duplicate events never
   * trigger this fetch at all.
   */
  async enrichEvent(event: NormalizedEvent): Promise<void> {
    try {
      const messages =
        this.cachedMessages ?? (await this.comments.getMessages(this.channel, this.threadTs || ''));
      if (!this.cachedMessages) {
        this.cachedMessages = messages;
      }

      if (messages.length === 0) {
        return;
      }

      event.resource.description = messages
        .map((m) => {
          let line = `[${m.ts}] <@${m.user}>: ${m.text}`;
          if (m.files?.length) {
            const fileList = m.files
              .map(
                (f) =>
                  `${f.name} (${f.filetype || f.mimetype || 'file'}): ${f.url_private || f.permalink || ''}`
              )
              .join(', ');
            line += `\n[Attachments: ${fileList}]`;
          }
          return line;
        })
        .join('\n\n');
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
