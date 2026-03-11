import { withExponentialRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

interface LinearComment {
  id: string;
  body: string;
  user: {
    id: string;
    name: string;
    email: string;
    displayName: string;
  };
  createdAt: string;
}

export class LinearComments {
  private readonly apiUrl = 'https://api.linear.app/graphql';

  constructor(private readonly apiKey: string) {}

  async getComments(issueId: string): Promise<LinearComment[]> {
    const query = `
      query GetIssueComments($issueId: String!) {
        issue(id: $issueId) {
          comments {
            nodes {
              id
              body
              user {
                id
                name
                email
                displayName
              }
              createdAt
            }
          }
        }
      }
    `;

    logger.debug('Fetching comments from Linear', {
      endpoint: this.apiUrl,
      issueId,
    });

    const startTime = Date.now();
    const response = await fetchWithTimeout(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { issueId },
      }),
    });
    const duration = Date.now() - startTime;

    logger.debug(`Linear API response received`, {
      operation: 'getComments',
      status: response.status,
      duration: `${duration}ms`,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `Failed to fetch comments from Linear: ${response.status} ${response.statusText} - ${errorText}`
      );
      throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const data = result as any;

    if (data.errors) {
      logger.error(`Linear GraphQL errors while fetching comments`, { errors: data.errors });
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const comments = data.data?.issue?.comments?.nodes || [];
    logger.debug(`Fetched ${comments.length} comments from Linear issue ${issueId}`);

    return comments;
  }

  async getAuthenticatedUser(): Promise<string | null> {
    const query = `{ viewer { name } }`;
    try {
      const response = await fetchWithTimeout(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        logger.warn(
          `Linear API error getting authenticated user: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const result = await response.json();
      const data = result as any;

      if (data.errors) {
        logger.warn('Linear GraphQL errors while fetching viewer', { errors: data.errors });
        return null;
      }

      return data.data?.viewer?.name ?? null;
    } catch (error) {
      logger.error('Error fetching authenticated Linear user', error);
      return null;
    }
  }

  async postComment(issueId: string, body: string): Promise<string> {
    const mutation = `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment {
            id
          }
        }
      }
    `;

    logger.debug('Posting comment to Linear', {
      issueId,
      bodyLength: body.length,
      bodyPreview: body.substring(0, 100),
    });

    const executePost = async () => {
      const startTime = Date.now();
      const response = await fetchWithTimeout(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: mutation,
          variables: { issueId, body },
        }),
      });
      const duration = Date.now() - startTime;

      logger.debug(`Linear API response received`, {
        operation: 'postComment',
        status: response.status,
        duration: `${duration}ms`,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `Failed to post comment to Linear: ${response.status} ${response.statusText} - ${errorText}`
        );
        throw new Error(
          `Failed to post comment: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const result = await response.json();
      const data = result as any;

      if (data.errors) {
        logger.error(`Linear GraphQL errors while posting comment`, { errors: data.errors });
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      if (!data.data?.commentCreate?.success) {
        logger.error('Linear commentCreate returned success=false');
        throw new Error('Failed to create comment');
      }

      const commentId = data.data.commentCreate.comment.id;
      logger.info(`Posted comment to Linear issue ${issueId}`, { commentId });

      return commentId;
    };

    return withExponentialRetry(executePost, {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    });
  }
}
