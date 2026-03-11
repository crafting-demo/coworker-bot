import { logger } from '../../utils/logger.js';
import { withExponentialRetry } from '../../utils/retry.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

export interface CommentInfo {
  author: string;
  body: string;
  createdAt: Date;
}

export class GitHubComments {
  constructor(private readonly token: string) {}

  async getLastComment(
    repository: string,
    resourceType: string,
    resourceNumber: number
  ): Promise<CommentInfo | null> {
    const base = this.getCommentsEndpoint(repository, resourceType, resourceNumber);
    if (!base) {
      return null;
    }

    const fetchPage = async (url: string) => {
      const response = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'coworker-bot-watcher',
        },
      });

      if (!response.ok) {
        if (response.status === 409) {
          throw response;
        }
        logger.warn(`GitHub API error getting comments: ${response.status} ${response.statusText}`);
        return null;
      }

      return response;
    };

    try {
      return await withExponentialRetry(async () => {
        // The comments endpoint returns results in ascending order only (no sort/direction support).
        // Use the Link header to jump directly to the last page.
        const firstResponse = await fetchPage(`${base}?per_page=100`);
        if (!firstResponse) return null;

        const linkHeader = firstResponse.headers.get('Link');
        const lastPageUrl = linkHeader ? linkHeader.match(/<([^>]+)>;\s*rel="last"/)?.at(1) : null;

        const finalResponse = lastPageUrl ? await fetchPage(lastPageUrl) : firstResponse;

        if (!finalResponse) return null;

        const comments = (await finalResponse.json()) as Array<{
          user: { login: string };
          body: string;
          created_at: string;
        }>;

        logger.debug(
          `getLastComment: fetched ${comments.length} comment(s) for ${resourceType} #${resourceNumber} in ${repository}`,
          comments
        );

        if (comments.length === 0) {
          return null;
        }

        const lastComment = comments[comments.length - 1]!;

        return {
          author: lastComment.user.login,
          body: lastComment.body,
          createdAt: new Date(lastComment.created_at),
        };
      });
    } catch (error) {
      logger.error('Error fetching GitHub comments', error);
      return null;
    }
  }

  /**
   * List recent comments on an issue or PR
   * @param repository - Repository in format "owner/repo"
   * @param resourceNumber - Issue or PR number
   * @param limit - Maximum number of comments to fetch
   * @returns Array of recent comments
   */
  async listComments(
    repository: string,
    resourceNumber: number,
    limit: number = 10
  ): Promise<CommentInfo[]> {
    const endpoint = `https://api.github.com/repos/${repository}/issues/${resourceNumber}/comments?per_page=${limit}&sort=created&direction=desc`;

    try {
      return await withExponentialRetry(async () => {
        const response = await fetchWithTimeout(endpoint, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'coworker-bot-watcher',
          },
        });

        if (!response.ok) {
          if (response.status === 409) {
            throw response;
          }
          logger.warn(
            `GitHub API error listing comments: ${response.status} ${response.statusText}`
          );
          return [];
        }

        const comments = (await response.json()) as Array<{
          user: { login: string };
          body: string;
          created_at: string;
        }>;

        return comments.map((c) => ({
          author: c.user.login,
          body: c.body,
          createdAt: new Date(c.created_at),
        }));
      });
    } catch (error) {
      logger.error('Error listing GitHub comments', error);
      return [];
    }
  }

  async getPullRequest(
    repository: string,
    prNumber: number
  ): Promise<{ branch: string; mergeTo: string } | null> {
    const endpoint = `https://api.github.com/repos/${repository}/pulls/${prNumber}`;

    try {
      return await withExponentialRetry(async () => {
        const response = await fetchWithTimeout(endpoint, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'coworker-bot-watcher',
          },
        });

        if (!response.ok) {
          if (response.status === 409) {
            throw response;
          }
          logger.warn(
            `GitHub API error getting PR details: ${response.status} ${response.statusText}`
          );
          return null;
        }

        const pr = (await response.json()) as {
          head: { ref: string };
          base: { ref: string };
        };

        return {
          branch: pr.head.ref,
          mergeTo: pr.base.ref,
        };
      });
    } catch (error) {
      logger.error('Error fetching GitHub PR details', error);
      return null;
    }
  }

  async getAuthenticatedUser(): Promise<string | null> {
    try {
      return await withExponentialRetry(async () => {
        const response = await fetchWithTimeout('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'coworker-bot-watcher',
          },
        });

        if (!response.ok) {
          logger.warn(
            `GitHub API error getting authenticated user: ${response.status} ${response.statusText}`
          );
          return null;
        }

        const user = (await response.json()) as { login: string };
        return user.login;
      });
    } catch (error) {
      logger.error('Error fetching authenticated GitHub user', error);
      return null;
    }
  }

  async getAccessibleRepositories(): Promise<string[]> {
    try {
      return await withExponentialRetry(async () => {
        const response = await fetchWithTimeout(
          'https://api.github.com/user/repos?per_page=100&sort=updated',
          {
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'coworker-bot-watcher',
            },
          }
        );

        if (!response.ok) {
          logger.warn(
            `GitHub API error getting accessible repositories: ${response.status} ${response.statusText}`
          );
          return [];
        }

        const repos = (await response.json()) as Array<{ full_name: string }>;
        return repos.map((r) => r.full_name);
      });
    } catch (error) {
      logger.error('Error fetching accessible GitHub repositories', error);
      return [];
    }
  }

  async postComment(
    repository: string,
    resourceType: string,
    resourceNumber: number,
    comment: string
  ): Promise<void> {
    const endpoint = this.getCommentsEndpoint(repository, resourceType, resourceNumber);
    if (!endpoint) {
      throw new Error(`Unsupported resource type: ${resourceType}`);
    }

    await withExponentialRetry(async () => {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'coworker-bot-watcher',
        },
        body: JSON.stringify({ body: comment }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          throw response;
        }
        const errorText = await response.text();
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}: ${errorText}`
        );
      }

      logger.debug(`Posted comment to ${resourceType} #${resourceNumber} in ${repository}`);
    });
  }

  private getCommentsEndpoint(
    repository: string,
    resourceType: string,
    resourceNumber: number
  ): string | null {
    const baseUrl = 'https://api.github.com';

    switch (resourceType) {
      case 'issue':
        return `${baseUrl}/repos/${repository}/issues/${resourceNumber}/comments`;
      case 'pull_request':
        return `${baseUrl}/repos/${repository}/issues/${resourceNumber}/comments`;
      default:
        logger.warn(`Unsupported resource type for comments: ${resourceType}`);
        return null;
    }
  }
}
