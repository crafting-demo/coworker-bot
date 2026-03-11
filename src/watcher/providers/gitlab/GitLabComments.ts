import { withExponentialRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

interface GitLabComment {
  id: number;
  body: string;
  author: {
    username: string;
  };
  created_at: string;
}

export class GitLabComments {
  private readonly baseUrl: string;

  constructor(
    private readonly token: string,
    baseUrl?: string
  ) {
    this.baseUrl = baseUrl || 'https://gitlab.com/api/v4';
  }

  async getComments(
    projectId: string,
    resourceType: string,
    resourceNumber: number
  ): Promise<GitLabComment[]> {
    const endpoint = this.getCommentsEndpoint(projectId, resourceType, resourceNumber);
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as GitLabComment[];
  }

  /**
   * List recent notes/comments on a merge request
   * @param projectId - GitLab project ID
   * @param mrNumber - Merge request number
   * @param limit - Maximum number of notes to fetch
   * @returns Array of recent notes
   */
  async listNotes(
    projectId: string,
    mrNumber: number,
    limit: number = 10
  ): Promise<GitLabComment[]> {
    const encodedProjectId = encodeURIComponent(projectId);
    const endpoint = `/projects/${encodedProjectId}/merge_requests/${mrNumber}/notes`;
    const url = `${this.baseUrl}${endpoint}?per_page=${limit}&sort=desc&order_by=created_at`;

    try {
      const response = await withExponentialRetry(async () => {
        const res = await fetchWithTimeout(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch notes: ${res.status} ${res.statusText}`);
        }

        return res;
      });

      const data = await response.json();
      return data as GitLabComment[];
    } catch {
      // Return empty array on error to allow graceful degradation
      return [];
    }
  }

  async getAuthenticatedUser(): Promise<string | null> {
    try {
      return await withExponentialRetry(async () => {
        const response = await fetchWithTimeout(`${this.baseUrl}/user`, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          logger.warn(
            `GitLab API error getting authenticated user: ${response.status} ${response.statusText}`
          );
          return null;
        }

        const user = (await response.json()) as { username: string };
        return user.username;
      });
    } catch (error) {
      logger.error('Error fetching authenticated GitLab user', error);
      return null;
    }
  }

  async postComment(
    projectId: string,
    resourceType: string,
    resourceNumber: number,
    body: string
  ): Promise<number> {
    const endpoint = this.getCommentsEndpoint(projectId, resourceType, resourceNumber);
    const url = `${this.baseUrl}${endpoint}`;

    const executePost = async () => {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to post comment: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      const comment = data as GitLabComment;
      return comment.id;
    };

    return withExponentialRetry(executePost, {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    });
  }

  private getCommentsEndpoint(
    projectId: string,
    resourceType: string,
    resourceNumber: number
  ): string {
    const encodedProjectId = encodeURIComponent(projectId);
    if (resourceType === 'merge_request') {
      return `/projects/${encodedProjectId}/merge_requests/${resourceNumber}/notes`;
    } else {
      return `/projects/${encodedProjectId}/issues/${resourceNumber}/notes`;
    }
  }
}
