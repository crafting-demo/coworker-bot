import { withExponentialRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

interface SlackSearchResult {
  ok: boolean;
  messages?: {
    matches: Array<{
      channel: {
        id: string;
        name?: string;
      };
      ts: string;
      text: string;
      username: string;
      user: string;
      permalink?: string;
      thread_ts?: string;
    }>;
  };
  error?: string;
}

/**
 * Slack poller that searches for missed @mentions.
 * Uses Slack's search.messages API to find messages that mention the bot.
 * This provides a fallback mechanism when webhooks fail or are unavailable.
 */
export class SlackPoller {
  private readonly baseUrl = 'https://slack.com/api';
  private lastPollTimestamp: number;

  constructor(
    private readonly token: string,
    private readonly botUserId: string,
    initialLookbackHours: number = 1
  ) {
    // Initialize lastPollTimestamp to look back N hours
    const now = Date.now();
    this.lastPollTimestamp = now - initialLookbackHours * 60 * 60 * 1000;
  }

  /**
   * Poll for missed mentions.
   * Searches for messages that mention the bot since the last poll.
   */
  async poll(): Promise<
    Array<{
      channel: string;
      ts: string;
      threadTs?: string;
      text: string;
      user: string;
      permalink?: string;
    }>
  > {
    return withExponentialRetry(async () => {
      const now = Date.now();
      const afterTimestamp = Math.floor(this.lastPollTimestamp / 1000);

      // Search for messages that mention the bot
      // Query format: "mentions:<@USER_ID> after:TIMESTAMP"
      const query = `<@${this.botUserId}> after:${afterTimestamp}`;

      logger.debug(`Polling Slack for mentions with query: ${query}`);

      const endpoint = `${this.baseUrl}/search.messages`;
      const params = new URLSearchParams({
        query,
        sort: 'timestamp',
        sort_dir: 'asc',
        count: '100', // Max results per request
      });

      const response = await fetchWithTimeout(`${endpoint}?${params}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(
          `Slack search API error: ${response.status} ${response.statusText} - ${errorText}`
        );
        return [];
      }

      const data = (await response.json()) as SlackSearchResult;

      if (!data.ok) {
        logger.warn(`Slack search API returned error: ${data.error}`);
        return [];
      }

      const matches = data.messages?.matches || [];
      logger.debug(`Found ${matches.length} mentions since last poll`);

      // Update last poll timestamp
      this.lastPollTimestamp = now;

      // Transform results to normalized format
      return matches.map((match) => {
        const result: {
          channel: string;
          ts: string;
          threadTs?: string;
          text: string;
          user: string;
          permalink?: string;
        } = {
          channel: match.channel.id,
          ts: match.ts,
          text: match.text,
          user: match.user,
        };

        if (match.thread_ts) {
          result.threadTs = match.thread_ts;
        }

        if (match.permalink) {
          result.permalink = match.permalink;
        }

        return result;
      });
    });
  }

  /**
   * Get the last poll timestamp (for debugging/monitoring).
   */
  getLastPollTimestamp(): number {
    return this.lastPollTimestamp;
  }
}
