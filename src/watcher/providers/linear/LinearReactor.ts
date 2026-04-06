import type { Reactor, NormalizedEvent } from '../../types/index.js';
import type { LinearComments, LinearIssueWithComments } from './LinearComments.js';
import { logger } from '../../utils/logger.js';

export class LinearReactor implements Reactor {
  /**
   * Cached result of getComments() — populated during the dedup check so that
   * enrichEvent() can reuse it without a second API call.
   */
  private cachedIssue?: LinearIssueWithComments;

  constructor(
    private readonly comments: LinearComments,
    private readonly issueId: string,
    private readonly botUsernames: string[]
  ) {}

  async getLastComment(): Promise<{ author: string; body: string } | null> {
    try {
      const issueData = await this.comments.getComments(this.issueId);
      // Cache so enrichEvent() can reuse without another API call
      this.cachedIssue = issueData;

      const { comments } = issueData;

      if (comments.length === 0) {
        logger.debug(`No comments found for Linear issue ${this.issueId}`);
        return null;
      }

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

  /**
   * Enrich the normalized event with the full issue context (description and
   * comment history) needed for prompt rendering.  Uses the cached getComments()
   * result from the preceding dedup check, so no additional API call is made.
   */
  async enrichEvent(event: NormalizedEvent): Promise<void> {
    try {
      const issueData = this.cachedIssue ?? (await this.comments.getComments(this.issueId));
      if (!this.cachedIssue) {
        this.cachedIssue = issueData;
      }

      if (issueData.description !== null) {
        event.resource.description = issueData.description;
      }
      event.resource.comments = issueData.comments.map((c) => ({
        body: c.body,
        author: c.user.name,
        createdAt: c.createdAt,
      }));
    } catch (error) {
      logger.warn(`Failed to enrich event with Linear issue context for ${this.issueId}`, error);
      // Non-fatal: prompt will render with whatever context is already in the event
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
