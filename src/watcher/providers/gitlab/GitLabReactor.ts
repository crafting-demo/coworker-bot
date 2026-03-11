import type { Reactor } from '../../types/index.js';
import type { GitLabComments } from './GitLabComments.js';
import { logger } from '../../utils/logger.js';

export class GitLabReactor implements Reactor {
  constructor(
    private readonly comments: GitLabComments,
    private readonly projectId: string,
    private readonly resourceType: string,
    private readonly resourceNumber: number,
    private readonly botUsernames: string[]
  ) {}

  async getLastComment(): Promise<{ author: string; body: string } | null> {
    try {
      const comments = await this.comments.getComments(
        this.projectId,
        this.resourceType,
        this.resourceNumber
      );

      if (comments.length === 0) {
        return null;
      }

      // Comments are returned in chronological order, so get the last one
      const lastComment = comments[comments.length - 1];

      if (!lastComment) {
        return null;
      }

      return {
        author: lastComment.author.username,
        body: lastComment.body,
      };
    } catch (error) {
      logger.error('Failed to get last comment from GitLab', error);
      throw error;
    }
  }

  async postComment(comment: string): Promise<string> {
    try {
      const commentId = await this.comments.postComment(
        this.projectId,
        this.resourceType,
        this.resourceNumber,
        comment
      );

      return String(commentId);
    } catch (error) {
      logger.error('Failed to post comment to GitLab', error);
      throw error;
    }
  }

  isBotAuthor(author: string): boolean {
    return this.botUsernames.some((name) => name.toLowerCase() === author.toLowerCase());
  }
}
