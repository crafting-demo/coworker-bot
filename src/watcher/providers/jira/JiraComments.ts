import { withExponentialRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

interface JiraCommentItem {
  id: string;
  author: {
    accountId: string;
    displayName: string;
    emailAddress?: string;
  };
  body: unknown; // ADF or plain string
  created: string;
  updated?: string;
}

export class JiraComments {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeader: string
  ) {}

  async getComments(issueKey: string): Promise<JiraCommentItem[]> {
    const url = `${this.baseUrl}/rest/api/3/issue/${issueKey}/comment?orderBy=created`;

    logger.debug('Fetching comments from Jira', { issueKey });

    const startTime = Date.now();
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
    });
    const duration = Date.now() - startTime;

    logger.debug(`Jira API response received`, {
      operation: 'getComments',
      status: response.status,
      duration: `${duration}ms`,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `Failed to fetch comments from Jira: ${response.status} ${response.statusText} - ${errorText}`
      );
      throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
    }

    // Jira REST API v3 GET /issue/{key}/comment returns a paginated object with a "values" array
    const result = (await response.json()) as { values?: JiraCommentItem[] };
    const comments = result.values ?? [];

    logger.debug(`Fetched ${comments.length} comments from Jira issue ${issueKey}`);

    return comments;
  }

  async postComment(issueKey: string, body: string): Promise<string> {
    const url = `${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`;

    logger.debug('Posting comment to Jira', {
      issueKey,
      bodyLength: body.length,
      bodyPreview: body.substring(0, 100),
    });

    const executePost = async () => {
      // Jira REST API v3 requires Atlassian Document Format (ADF) for comment bodies
      const adfBody = {
        version: 1,
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: body }],
          },
        ],
      };

      const startTime = Date.now();
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ body: adfBody }),
      });
      const duration = Date.now() - startTime;

      logger.debug(`Jira API response received`, {
        operation: 'postComment',
        status: response.status,
        duration: `${duration}ms`,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `Failed to post comment to Jira: ${response.status} ${response.statusText} - ${errorText}`
        );
        throw new Error(
          `Failed to post comment: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const result = (await response.json()) as { id: string };
      const commentId = result.id;
      logger.info(`Posted comment to Jira issue ${issueKey}`, { commentId });

      return commentId;
    };

    return withExponentialRetry(executePost, {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    });
  }

  async getAuthenticatedUser(): Promise<{ accountId: string; displayName: string } | null> {
    const url = `${this.baseUrl}/rest/api/3/myself`;

    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(
          `Jira API error getting authenticated user: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const result = (await response.json()) as { accountId: string; displayName: string };
      return { accountId: result.accountId, displayName: result.displayName };
    } catch (error) {
      logger.error('Error fetching authenticated Jira user', error);
      return null;
    }
  }
}
