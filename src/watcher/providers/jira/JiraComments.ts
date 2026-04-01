import { withExponentialRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

type AdfMark = { type: string; attrs?: Record<string, unknown> };
type AdfNode = {
  type: string;
  text?: string;
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
};

/**
 * Parse a markdown inline string into ADF inline content nodes.
 * Handles: **bold**, *italic*, `code`, [text](url), [text|url] (Jira wiki links).
 */
function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  // Matches: **bold**, *italic*, `code`, [text](url), [text|url]
  const pattern =
    /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\[([^\]]+)\|([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      // **bold**
      nodes.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }] });
    } else if (match[2] !== undefined) {
      // *italic*
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'em' }] });
    } else if (match[3] !== undefined) {
      // `code`
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // [text](url)
      nodes.push({
        type: 'text',
        text: match[4],
        marks: [{ type: 'link', attrs: { href: match[5] } }],
      });
    } else if (match[6] !== undefined && match[7] !== undefined) {
      // [text|url] Jira wiki link
      nodes.push({
        type: 'text',
        text: match[6],
        marks: [{ type: 'link', attrs: { href: match[7] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes;
}

/**
 * Convert a markdown string to an Atlassian Document Format (ADF) document.
 * Handles: paragraphs, headings, bullet lists, code blocks, and inline formatting.
 */
function markdownToAdf(markdown: string): unknown {
  const lines = markdown.split('\n');
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block — only treat as code if a closing fence is found
    if (line.startsWith('```')) {
      const closingIndex = lines.findIndex((l, idx) => idx > i && l.startsWith('```'));
      if (closingIndex !== -1) {
        const lang = line.slice(3).trim();
        const codeLines = lines.slice(i + 1, closingIndex);
        const codeText = codeLines.join('\n');
        if (codeText) {
          content.push({
            type: 'codeBlock',
            attrs: lang ? { language: lang } : {},
            content: [{ type: 'text', text: codeText }],
          });
        }
        i = closingIndex + 1;
      } else {
        // Unclosed fence — treat the ``` line as plain text to avoid swallowing remaining content
        content.push({ type: 'paragraph', content: parseInline(line) });
        i++;
      }
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: 'heading',
        attrs: { level: headingMatch[1]!.length },
        content: parseInline(headingMatch[2]!),
      });
      i++;
      continue;
    }

    // Bullet list: collect consecutive list items
    if (line.match(/^[-*]\s+/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && (lines[i] ?? '').match(/^[-*]\s+/)) {
        const itemText = (lines[i] ?? '').replace(/^[-*]\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(itemText) }],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: accumulate consecutive plain lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.trim() === '' || l.startsWith('```') || l.match(/^[-*]\s+/) || l.match(/^#{1,6}\s+/))
        break;
      paraLines.push(l);
      i++;
    }
    if (paraLines.length > 0) {
      content.push({ type: 'paragraph', content: parseInline(paraLines.join('\n')) });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [] });
  }

  return { version: 1, type: 'doc', content };
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
      // Convert the markdown body to ADF so formatting is preserved.
      const adfBody = markdownToAdf(body);

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
