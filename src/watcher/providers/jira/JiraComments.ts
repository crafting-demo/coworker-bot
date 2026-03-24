import { withExponentialRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

/**
 * Parse a plain-text string into ADF inline content nodes.
 * Tokens of the form [text|url] are emitted as text nodes with a link mark;
 * everything else is emitted as a plain text node.
 */
function buildAdfInlineContent(text: string): unknown[] {
  const nodes: unknown[] = [];
  const linkPattern = /\[([^\]]+)\|([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    nodes.push({
      type: 'text',
      text: match[1],
      marks: [{ type: 'link', attrs: { href: match[2] } }],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes;
}

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
    logger.debug('Fetching comments from Jira', { issueKey });

    const allComments: JiraCommentItem[] = [];
    const pageSize = 100;
    let startAt = 0;

    for (;;) {
      const url = `${this.baseUrl}/rest/api/3/issue/${issueKey}/comment?orderBy=created&maxResults=${pageSize}&startAt=${startAt}`;

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

      // Jira REST API v3 GET /issue/{key}/comment returns { comments: [...], startAt, maxResults, total }
      const result = (await response.json()) as {
        comments?: JiraCommentItem[];
        total?: number;
      };
      const page = result.comments ?? [];
      allComments.push(...page);

      const total = result.total ?? allComments.length;
      if (allComments.length >= total || page.length < pageSize) {
        break;
      }

      startAt += page.length;
    }

    logger.debug(`Fetched ${allComments.length} comments from Jira issue ${issueKey}`);

    return allComments;
  }

  async postComment(issueKey: string, body: string): Promise<string> {
    const url = `${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`;

    logger.debug('Posting comment to Jira', {
      issueKey,
      bodyLength: body.length,
      bodyPreview: body.substring(0, 100),
    });

    const executePost = async () => {
      // Jira REST API v3 requires Atlassian Document Format (ADF) for comment bodies.
      // Parse [text|url] link tokens in the body and emit proper ADF inline link nodes.
      const adfBody = {
        version: 1,
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: buildAdfInlineContent(body),
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
