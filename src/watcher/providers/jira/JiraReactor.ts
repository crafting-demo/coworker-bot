import type { Reactor } from '../../types/index.js';
import type { JiraComments } from './JiraComments.js';
import { extractTextFromADF } from './JiraNormalizer.js';
import { logger } from '../../utils/logger.js';

export class JiraReactor implements Reactor {
  constructor(
    private readonly comments: JiraComments,
    private readonly issueKey: string,
    private readonly botUsernames: string[]
  ) {}

  async getLastComment(): Promise<{ author: string; body: string } | null> {
    try {
      const comments = await this.comments.getComments(this.issueKey);

      if (comments.length === 0) {
        logger.debug(`No comments found for Jira issue ${this.issueKey}`);
        return null;
      }

      const lastComment = comments[comments.length - 1];
      if (!lastComment) {
        return null;
      }

      const author = lastComment.author.displayName;
      const body = extractTextFromADF(lastComment.body);

      logger.debug(`Last comment on Jira issue ${this.issueKey}:`, {
        author,
        bodyPreview: body.substring(0, 100),
      });

      return { author, body };
    } catch (error) {
      logger.error('Failed to get last comment from Jira', error);
      throw error;
    }
  }

  async postComment(comment: string): Promise<string> {
    try {
      const commentId = await this.comments.postComment(this.issueKey, comment);
      return commentId;
    } catch (error) {
      logger.error('Failed to post comment to Jira', error);
      throw error;
    }
  }

  isBotAuthor(author: string): boolean {
    return this.botUsernames.some((name) => name.toLowerCase() === author.toLowerCase());
  }
}
