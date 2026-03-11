import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

interface LinearPollerConfig {
  apiKey: string;
  teams?: string[];
  initialLookbackHours?: number;
  maxItemsPerPoll?: number;
}

interface LinearItem {
  type: 'issue';
  team: string;
  number: number;
  data: any;
}

export class LinearPoller {
  private lastPoll: Date | undefined;
  private readonly apiUrl = 'https://api.linear.app/graphql';

  constructor(private readonly config: LinearPollerConfig) {}

  async poll(): Promise<LinearItem[]> {
    const allItems: LinearItem[] = [];

    let since = this.lastPoll;

    if (!since) {
      const lookbackHours = this.config.initialLookbackHours ?? 1;
      since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      logger.info(
        `First poll for Linear, looking back ${lookbackHours} hour(s) (since ${since.toISOString()})`
      );
    } else {
      logger.debug(`Polling Linear for changes since ${since.toISOString()}`);
    }

    const teamFilter =
      this.config.teams && this.config.teams.length > 0
        ? `teams: [${this.config.teams.join(', ')}]`
        : 'all teams';

    logger.debug(`Polling Linear issues`, {
      since: since.toISOString(),
      filter: teamFilter,
      maxItems: this.config.maxItemsPerPoll || 'unlimited',
    });

    try {
      const issues = await this.fetchIssues(since);

      if (issues.length > 0) {
        logger.info(`Found ${issues.length} issues from Linear`, {
          teams: [...new Set(issues.map((i) => i.team))],
          numbers: issues.map((i) => i.number),
        });
      } else {
        logger.debug('No new issues from Linear');
      }

      allItems.push(...issues);

      this.lastPoll = new Date();

      // Apply max items limit if configured
      if (this.config.maxItemsPerPoll && allItems.length > this.config.maxItemsPerPoll) {
        logger.info(`Trimming items from ${allItems.length} to ${this.config.maxItemsPerPoll}`);
        return allItems.slice(0, this.config.maxItemsPerPoll);
      }
    } catch (error) {
      logger.error('Error polling Linear', error);
    }

    logger.debug(`Total items found: ${allItems.length}`);
    return allItems;
  }

  private async fetchIssues(since: Date): Promise<LinearItem[]> {
    // Linear's GraphQL API requires ISO date string directly in the filter
    const isoDate = since.toISOString();

    const query = `
      query {
        issues(
          filter: { updatedAt: { gte: "${isoDate}" } }
          orderBy: updatedAt
        ) {
          nodes {
            id
            identifier
            number
            title
            description
            url
            state {
              name
            }
            team {
              key
              name
            }
            assignee {
              name
            }
            creator {
              name
            }
            labels {
              nodes {
                name
              }
            }
            updatedAt
            createdAt
          }
        }
      }
    `;

    logger.debug('Fetching issues from Linear GraphQL API', {
      endpoint: this.apiUrl,
      since: isoDate,
      hasApiKey: !!this.config.apiKey,
      apiKeyPrefix: this.config.apiKey?.substring(0, 10) + '...',
    });

    const startTime = Date.now();
    const response = await fetchWithTimeout(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    const duration = Date.now() - startTime;

    logger.debug(`Linear API response received`, {
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
        // Ignore if we can't read the error body
      }
      logger.error(`Linear API error: ${errorDetails}`);
      throw new Error(`Failed to fetch issues from Linear API: ${errorDetails}`);
    }

    const result = await response.json();
    const data = result as any;

    if (data.errors) {
      const errorMessages = data.errors.map((e: any) => e.message).join(', ');
      logger.error(`Linear GraphQL errors: ${errorMessages}`, { errors: data.errors });
      throw new Error(`Linear GraphQL errors: ${errorMessages}`);
    }

    const issues = data.data?.issues?.nodes || [];
    logger.debug(`Received ${issues.length} issues from Linear API`);

    const items: LinearItem[] = [];

    for (const issue of issues) {
      // Filter by team if configured
      if (this.config.teams && this.config.teams.length > 0) {
        if (!this.config.teams.includes(issue.team.key)) {
          logger.debug(`Skipping issue ${issue.identifier} (team ${issue.team.key} not in filter)`);
          continue;
        }
      }

      // Filter by updated_at
      if (since && new Date(issue.updatedAt) <= since) {
        logger.debug(`Skipping issue ${issue.identifier} (not updated since last poll)`, {
          updatedAt: issue.updatedAt,
          sinceFilter: since.toISOString(),
        });
        continue;
      }

      logger.debug(`Processing issue ${issue.identifier}`, {
        title: issue.title,
        team: issue.team.key,
        state: issue.state.name,
        updatedAt: issue.updatedAt,
      });

      items.push({
        type: 'issue',
        team: issue.team.key,
        number: issue.number,
        data: issue,
      });
    }

    logger.debug(`Collected ${items.length} issues from Linear`);
    return items;
  }
}
