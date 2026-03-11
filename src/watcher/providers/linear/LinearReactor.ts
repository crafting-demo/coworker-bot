import type { Reactor } from '../../types/index.js';
import type { LinearComments } from './LinearComments.js';
import { logger } from '../../utils/logger.js';

export class LinearReactor implements Reactor {
  constructor(
    private readonly comments: LinearComments,
    private readonly issueId: string,
    private readonly botUsernames: string[]
  ) {}

  async getLastComment(): Promise<{ author: string; body: string } | null> {
    try {
      const comments = await this.comments.getComments(this.issueId);

      if (comments.length === 0) {
        logger.debug(`No comments found for Linear issue ${this.issueId}`);
        return null;
      }

      // Get the last comment
      const lastComment = comments[comments.length - 1];

      if (!lastComment) {
        return null;
      }

      // Linear API returns:
      // - name: username (e.g., "john-doe")
      // - displayName: display name (e.g., "John Doe")
      // - email: email address
      // Use name (username) as the primary identifier for deduplication
      const author = lastComment.user.name;

      logger.debug(`Last comment on Linear issue ${this.issueId}:`, {
        author,
        username: lastComment.user.name,
        displayName: lastComment.user.displayName,
        email: lastComment.user.email,
        bodyPreview: lastComment.body.substring(0, 100),
      });

      return {
        author,
        body: lastComment.body,
      };
    } catch (error) {
      logger.error('Failed to get last comment from Linear', error);
      throw error;
    }
  }

  async postComment(comment: string): Promise<string> {
    try {
      const commentId = await this.comments.postComment(this.issueId, comment);
      return commentId;
    } catch (error) {
      logger.error('Failed to post comment to Linear', error);
      throw error;
    }
  }

  isBotAuthor(author: string): boolean {
    return this.botUsernames.some((name) => name.toLowerCase() === author.toLowerCase());
  }
}
