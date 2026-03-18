import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';
import type { JiraIssue } from './JiraNormalizer.js';

interface JiraPollerConfig {
  baseUrl: string;
  authHeader: string;
  projects?: string[];
  initialLookbackHours?: number;
  maxItemsPerPoll?: number;
}

export class JiraPoller {
  private lastPoll: Date | undefined;

  constructor(private readonly config: JiraPollerConfig) {}

  async poll(): Promise<JiraIssue[]> {
    let since = this.lastPoll;

    if (!since) {
      const lookbackHours = this.config.initialLookbackHours ?? 1;
      since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      logger.info(
        `First poll for Jira, looking back ${lookbackHours} hour(s) (since ${since.toISOString()})`
      );
    } else {
      logger.debug(`Polling Jira for changes since ${since.toISOString()}`);
    }

    // Jira JQL date format: "YYYY-MM-DD HH:mm" (UTC)
    const sinceStr = formatJqlDate(since);

    let jql = `updated >= "${sinceStr}"`;

    if (this.config.projects && this.config.projects.length > 0) {
      const projectList = this.config.projects.map((p) => `"${p}"`).join(', ');
      jql = `project in (${projectList}) AND ${jql}`;
    }

    jql += ' ORDER BY updated ASC';

    const maxResults = this.config.maxItemsPerPoll ?? 50;

    logger.debug('Polling Jira issues', { jql, maxResults });

    try {
      const issues = await this.fetchIssues(jql, maxResults, since);

      if (issues.length > 0) {
        logger.info(`Found ${issues.length} issues from Jira`, {
          keys: issues.map((i) => i.key),
        });
      } else {
        logger.debug('No new issues from Jira');
      }

      this.lastPoll = new Date();
      return issues;
    } catch (error) {
      logger.error('Error polling Jira', error);
      return [];
    }
  }

  private async fetchIssues(jql: string, maxResults: number, since: Date): Promise<JiraIssue[]> {
    const url = `${this.config.baseUrl}/rest/api/3/search/jql`;

    const startTime = Date.now();
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: this.config.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jql,
        maxResults,
        fields: [
          'summary',
          'description',
          'status',
          'project',
          'assignee',
          'reporter',
          'labels',
          'issuetype',
          'priority',
          'created',
          'updated',
        ],
      }),
    });
    const duration = Date.now() - startTime;

    logger.debug(`Jira API response received`, {
      status: response.status,
      statusText: response.statusText,
      duration: `${duration}ms`,
    });

    if (!response.ok) {
      let errorDetails = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        errorDetails += ` - ${errorBody}`;
      } catch {
        // ignore
      }
      logger.error(`Jira API error: ${errorDetails}`);
      throw new Error(`Failed to fetch issues from Jira API: ${errorDetails}`);
    }

    // /rest/api/3/search/jql response: { issues, nextPageToken, isLast }
    // (no `total` field unlike the deprecated /rest/api/3/search)
    const result = (await response.json()) as {
      issues?: JiraIssue[];
      nextPageToken?: string;
      isLast?: boolean;
    };
    const issues = result.issues ?? [];

    logger.debug(`Received ${issues.length} issues from Jira API`);

    // Secondary filter: skip issues not actually updated since the last poll (API may over-return).
    // fields.updated is a Unix epoch millisecond integer per the search/jql response schema.
    return issues.filter((issue) => {
      const updatedAt = new Date(issue.fields.updated ?? 0);
      if (updatedAt <= since) {
        logger.debug(`Skipping issue ${issue.key} (not updated since last poll)`);
        return false;
      }
      return true;
    });
  }
}

/**
 * Format a Date as a Jira JQL datetime string: "YYYY-MM-DD HH:mm"
 * Jira interprets this in the server's timezone; using UTC values is safe
 * because the filter only needs to be roughly accurate (we do a secondary
 * client-side filter on the returned issues).
 */
function formatJqlDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}
