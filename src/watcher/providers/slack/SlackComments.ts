import { withExponentialRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';
import type { SlackFile } from './SlackNormalizer.js';

interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  blocks?: SlackMessageBlock[];
  attachments?: SlackMessageAttachment[];
  files?: SlackFile[];
  username?: string;
  bot_id?: string;
}

interface SlackTextObject {
  text?: string;
}

interface SlackMessageAttachment {
  fallback?: string;
  pretext?: string;
  text?: string;
  title?: string;
  fields?: SlackAttachmentField[];
  blocks?: SlackMessageBlock[];
}

interface SlackAttachmentField {
  title?: string;
  value?: string;
}

interface SlackMessageBlock {
  type?: string;
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  elements?: SlackBlockElement[];
}

interface SlackBlockElement {
  type?: string;
  text?: string;
  url?: string;
  name?: string;
  user_id?: string;
  channel_id?: string;
  usergroup_id?: string;
  range?: string;
  fallback?: string;
  elements?: SlackBlockElement[];
}

function messageText(message: SlackMessage): string {
  if (message.text.trim() !== '') {
    return message.text;
  }

  const parts = [
    blocksToText(message.blocks),
    attachmentBlocksToText(message.attachments),
    attachmentLegacyText(message.attachments),
  ].filter((part) => part !== '');

  return parts.join('\n');
}

function attachmentBlocksToText(attachments?: SlackMessageAttachment[]): string {
  if (!attachments?.length) {
    return '';
  }

  return attachments
    .map((attachment) => blocksToText(attachment.blocks))
    .filter((text) => text !== '')
    .join('\n');
}

function attachmentLegacyText(attachments?: SlackMessageAttachment[]): string {
  if (!attachments?.length) {
    return '';
  }

  return attachments
    .map((attachment) => legacyAttachmentText(attachment))
    .filter((text) => text !== '')
    .join('\n');
}

function legacyAttachmentText(attachment?: SlackMessageAttachment): string {
  if (!attachment) {
    return '';
  }

  const parts = [
    stringsTrim(attachment.title),
    stringsTrim(attachment.pretext),
    stringsTrim(attachment.text),
    attachmentFieldsText(attachment.fields),
  ].filter((text) => text !== '');

  if (parts.length > 0) {
    return parts.join('\n');
  }

  return stringsTrim(attachment.fallback);
}

function attachmentFieldsText(fields?: SlackAttachmentField[]): string {
  if (!fields?.length) {
    return '';
  }

  return fields
    .map((field) => attachmentFieldText(field))
    .filter((text) => text !== '')
    .join('\n');
}

function attachmentFieldText(field?: SlackAttachmentField): string {
  if (!field) {
    return '';
  }

  const title = stringsTrim(field.title);
  const value = stringsTrim(field.value);

  if (title !== '' && value !== '') {
    return `${title}\n${value}`;
  }

  return title || value;
}

function blocksToText(blocks?: SlackMessageBlock[]): string {
  if (!blocks?.length) {
    return '';
  }

  return blocks
    .map((block) => blockToText(block))
    .filter((text) => text !== '')
    .join('\n');
}

function blockToText(block?: SlackMessageBlock): string {
  if (!block?.type) {
    return '';
  }

  switch (block.type) {
    case 'header':
      return textObjectText(block.text);
    case 'section':
      return sectionBlockText(block);
    case 'context':
      return contextBlockText(block.elements);
    case 'rich_text':
      return richTextBlockText(block.elements);
    default:
      return '';
  }
}

function sectionBlockText(block: SlackMessageBlock): string {
  const parts = [textObjectText(block.text), ...(block.fields || []).map(textObjectText)].filter(
    (text) => text !== ''
  );
  return parts.join('\n');
}

function contextBlockText(elements?: SlackBlockElement[]): string {
  if (!elements?.length) {
    return '';
  }

  return elements
    .map((element) => {
      if (element.type === 'text' || element.type === 'mrkdwn') {
        return stringsTrim(element.text);
      }
      return '';
    })
    .filter((text) => text !== '')
    .join(' ');
}

function richTextBlockText(elements?: SlackBlockElement[]): string {
  if (!elements?.length) {
    return '';
  }

  return elements
    .map((element) => richTextElementText(element))
    .filter((text) => text !== '')
    .join('\n');
}

function richTextElementText(element?: SlackBlockElement): string {
  if (!element?.type) {
    return '';
  }

  switch (element.type) {
    case 'rich_text_section':
    case 'rich_text_quote':
      return richTextSectionText(element.elements);
    case 'rich_text_preformatted':
      return richTextSectionText(element.elements);
    case 'rich_text_list':
      return (element.elements || [])
        .map((child) => richTextElementText(child))
        .filter((text) => text !== '')
        .join('\n');
    case 'text':
      return element.text || '';
    case 'link':
      return element.text || element.url || '';
    case 'emoji':
      return element.name ? `:${element.name}:` : '';
    case 'user':
      return element.user_id ? `<@${element.user_id}>` : '';
    case 'channel':
      return element.channel_id ? `<#${element.channel_id}>` : '';
    case 'usergroup':
      return element.usergroup_id ? `<!subteam^${element.usergroup_id}>` : '';
    case 'broadcast':
      return element.range ? `<!${element.range}>` : '';
    case 'date':
      return element.fallback || '';
    default:
      return '';
  }
}

function richTextSectionText(elements?: SlackBlockElement[]): string {
  if (!elements?.length) {
    return '';
  }

  return elements
    .map((element) => richTextElementText(element))
    .filter((text) => text !== '')
    .join('');
}

function textObjectText(textObject?: SlackTextObject): string {
  return stringsTrim(textObject?.text);
}

function stringsTrim(text?: string): string {
  return (text || '').trim();
}

function messageAuthor(message: SlackMessage): string {
  const user = stringsTrim(message.user);
  if (user !== '') {
    return `<@${user}>`;
  }

  const username = stringsTrim(message.username);
  if (username !== '') {
    return username;
  }

  const botId = stringsTrim(message.bot_id);
  if (botId !== '') {
    return `<bot:${botId}>`;
  }

  return 'unknown';
}

function messageAuthorId(message: SlackMessage): string {
  const user = stringsTrim(message.user);
  if (user !== '') {
    return user;
  }

  const username = stringsTrim(message.username);
  if (username !== '') {
    return username;
  }

  const botId = stringsTrim(message.bot_id);
  if (botId !== '') {
    return botId;
  }

  return 'unknown';
}

/**
 * Slack API client for posting and fetching messages.
 * Uses Slack Web API with Bot OAuth token.
 */
export class SlackComments {
  private readonly baseUrl = 'https://slack.com/api';

  constructor(private readonly token: string) {}

  /**
   * Helper to fetch replies from a thread.
   */
  private async getReplies(channel: string, ts: string): Promise<SlackMessage[]> {
    return withExponentialRetry(async () => {
      const endpoint = `${this.baseUrl}/conversations.replies`;
      const params = new URLSearchParams({
        channel,
        ts,
        inclusive: 'true',
      });

      const response = await fetchWithTimeout(`${endpoint}?${params}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(`Slack API error getting replies: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = (await response.json()) as {
        ok: boolean;
        messages?: SlackMessage[];
        error?: string;
      };

      if (!data.ok) {
        logger.warn(`Slack API returned error: ${data.error}`);
        return [];
      }

      return data.messages || [];
    });
  }

  /**
   * Get the last message in a channel or thread.
   * Used for deduplication to check if bot already responded.
   */
  async getLastMessage(
    channel: string,
    threadTs?: string
  ): Promise<{ user: string; text: string } | null> {
    const messages = await this.getReplies(channel, threadTs || '');

    if (messages.length === 0) {
      return null;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return null;
    }

    return {
      user: messageAuthorId(lastMessage),
      text: lastMessage.text,
    };
  }

  /**
   * Post a message to a Slack channel or thread.
   * Returns the message timestamp (ts) which can be used as a reference.
   */
  async postMessage(channel: string, text: string, threadTs?: string): Promise<string> {
    return withExponentialRetry(async () => {
      const endpoint = `${this.baseUrl}/chat.postMessage`;

      const payload: any = {
        channel,
        text,
      };

      // If threadTs is provided, reply in thread
      if (threadTs) {
        payload.thread_ts = threadTs;
      }

      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Slack API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as { ok: boolean; ts?: string; error?: string };

      if (!data.ok) {
        throw new Error(`Slack API returned error: ${data.error}`);
      }

      if (!data.ts) {
        throw new Error('Slack API did not return message timestamp');
      }

      logger.debug(
        `Posted message to Slack channel ${channel}${threadTs ? ` (thread: ${threadTs})` : ''}`
      );

      return data.ts;
    });
  }

  /**
   * Update an existing Slack message.
   */
  /**
   * Get bot user ID.
   * Useful for checking if the bot was mentioned in a message.
   */
  async getBotInfo(): Promise<{ userId: string; username?: string }> {
    return withExponentialRetry(async () => {
      const endpoint = `${this.baseUrl}/auth.test`;

      logger.debug('Calling Slack auth.test to get bot user ID');

      const response = await fetchWithTimeout(endpoint, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Slack auth.test HTTP error', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        throw new Error(`Slack API HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const data = (await response.json()) as {
        ok: boolean;
        user_id?: string;
        error?: string;
        url?: string;
        team?: string;
        user?: string;
        team_id?: string;
      };

      logger.debug('Slack auth.test response', {
        ok: data.ok,
        error: data.error,
        user_id: data.user_id,
        user: data.user,
        team: data.team,
        team_id: data.team_id,
      });

      if (!data.ok || !data.user_id) {
        const errorDetails = JSON.stringify({
          error: data.error,
          ok: data.ok,
          response: data,
        });
        throw new Error(`Slack auth failed: ${data.error || 'unknown error'} (${errorDetails})`);
      }

      const result: { userId: string; username?: string } = { userId: data.user_id };
      if (data.user) result.username = data.user;
      return result;
    });
  }

  /**
   * Get a Slack user's profile info (email, username) via users.info.
   * Requires the users:read.email OAuth scope for email.
   * Returns an empty object if the call fails.
   */
  async getUserInfo(userId: string): Promise<{ email?: string; username?: string }> {
    try {
      const endpoint = `${this.baseUrl}/users.info`;
      const params = new URLSearchParams({ user: userId });

      const response = await fetchWithTimeout(`${endpoint}?${params}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(`Slack users.info HTTP error for user ${userId}: ${response.status}`);
        return {};
      }

      const data = (await response.json()) as {
        ok: boolean;
        user?: { name?: string; profile?: { email?: string; display_name?: string } };
        error?: string;
      };

      if (!data.ok) {
        logger.warn(`Slack users.info error for user ${userId}: ${data.error}`);
        return {};
      }

      const result: { email?: string; username?: string } = {};
      const email = data.user?.profile?.email;
      const username = data.user?.profile?.display_name || data.user?.name;
      if (email) result.email = email;
      if (username) result.username = username;
      return result;
    } catch (error) {
      logger.warn(`Failed to fetch Slack user info for ${userId}`, error);
      return {};
    }
  }

  /**
   * Get the full conversation history of a thread.
   * Returns formatted string: "@user: message"
   */
  async getConversationHistory(channel: string, threadTs: string): Promise<string> {
    const messages = await this.getReplies(channel, threadTs);

    if (messages.length === 0) {
      return '';
    }

    return messages
      .map((m) => {
        let line = `[${m.ts}] ${messageAuthor(m)}: ${messageText(m)}`;
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
  }
}
