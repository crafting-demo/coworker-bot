import { logger } from '../../utils/logger.js';
import { withExponentialRetry } from '../../utils/retry.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

interface GitHubPollerConfig {
  token: string;
  repositories: string[];
  events?: string[];
  initialLookbackHours?: number; // How many hours to look back on first poll (default: 1)
  maxItemsPerPoll?: number; // Max items to process per poll (default: unlimited)
}

interface GitHubItem {
  repository: string;
  type: 'issue' | 'pull_request';
  number: number;
  data: unknown;
}

export class GitHubPoller {
  private lastPoll: Map<string, Date> = new Map();

  constructor(private readonly config: GitHubPollerConfig) {}

  async poll(): Promise<GitHubItem[]> {
    const items: GitHubItem[] = [];

    logger.debug(`Polling ${this.config.repositories.length} repositories`);

    for (const repo of this.config.repositories) {
      try {
        logger.debug(`Polling repository: ${repo}`);
        const repoItems = await this.pollRepository(repo);

        if (repoItems.length > 0) {
          logger.info(`Found ${repoItems.length} items in ${repo}`, {
            issues: repoItems.filter((i) => i.type === 'issue').length,
            pullRequests: repoItems.filter((i) => i.type === 'pull_request').length,
          });
        } else {
          logger.debug(`No new items in ${repo}`);
        }

        items.push(...repoItems);

        // Stop if we've hit the max items limit
        if (this.config.maxItemsPerPoll && items.length >= this.config.maxItemsPerPoll) {
          logger.info(`Reached max items limit (${this.config.maxItemsPerPoll}), stopping poll`);
          break;
        }
      } catch (error) {
        logger.error(`Failed to poll repository ${repo}`, error);
      }
    }

    // Trim to max limit if needed
    if (this.config.maxItemsPerPoll && items.length > this.config.maxItemsPerPoll) {
      logger.info(`Trimming items from ${items.length} to ${this.config.maxItemsPerPoll}`);
      items.splice(this.config.maxItemsPerPoll);
    }

    logger.debug(`Total items found across all repositories: ${items.length}`);
    return items;
  }

  private async pollRepository(repo: string): Promise<GitHubItem[]> {
    const items: GitHubItem[] = [];
    let since = this.lastPoll.get(repo);

    // On first poll, use initialLookbackHours to avoid fetching too many items
    if (!since) {
      const lookbackHours = this.config.initialLookbackHours ?? 1; // Default: 1 hour
      since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      logger.info(
        `First poll for ${repo}, looking back ${lookbackHours} hour(s) (since ${since.toISOString()})`
      );
    } else {
      logger.debug(`Polling ${repo} for changes since ${since.toISOString()}`);
    }

    if (this.shouldPollEvent('issues')) {
      const issues = await this.fetchIssues(repo, since);
      if (issues.length > 0) {
        logger.debug(`Found ${issues.length} issues in ${repo}`);
      }
      items.push(...issues);
    }

    if (this.shouldPollEvent('pull_request')) {
      const prs = await this.fetchPullRequests(repo, since);
      if (prs.length > 0) {
        logger.debug(`Found ${prs.length} pull requests in ${repo}`);
      }
      items.push(...prs);
    }

    this.lastPoll.set(repo, new Date());

    return items;
  }

  private shouldPollEvent(eventType: string): boolean {
    if (!this.config.events || this.config.events.length === 0) {
      return true;
    }
    return this.config.events.includes(eventType);
  }

  private async fetchIssues(repo: string, since?: Date): Promise<GitHubItem[]> {
    const url = new URL(`https://api.github.com/repos/${repo}/issues`);
    url.searchParams.set('state', 'all');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');
    url.searchParams.set('per_page', '100');

    if (since) {
      url.searchParams.set('since', since.toISOString());
    }

    logger.debug(`Fetching issues from ${repo}`, {
      endpoint: url.toString(),
      sinceFilter: since ? since.toISOString() : 'none',
    });

    const issues = await withExponentialRetry(async () => {
      const response = await fetchWithTimeout(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'coworker-bot-watcher',
        },
      });

      if (!response.ok) {
        if (response.status === 409) {
          throw response;
        }
        logger.error(
          `GitHub API error for ${repo}/issues: ${response.status} ${response.statusText}`
        );
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    });

    const items: GitHubItem[] = [];

    for (const issue of issues as Array<{
      id: number;
      number: number;
      title?: string;
      updated_at: string;
      pull_request?: unknown;
    }>) {
      if (issue.pull_request) {
        continue;
      }

      // Filter by updated_at to ensure we only process recently updated issues
      if (since && new Date(issue.updated_at) <= since) {
        logger.debug(`Skipping issue #${issue.number} (not updated since last poll)`, {
          updatedAt: issue.updated_at,
          sinceFilter: since.toISOString(),
        });
        continue;
      }

      logger.debug(`Processing issue #${issue.number} from ${repo}`, {
        title: issue.title,
        updatedAt: issue.updated_at,
      });

      items.push({
        repository: repo,
        type: 'issue',
        number: issue.number,
        data: issue,
      });
    }

    logger.debug(`Collected ${items.length} issues from ${repo}`);
    return items;
  }

  private async fetchPullRequests(repo: string, since?: Date): Promise<GitHubItem[]> {
    const url = new URL(`https://api.github.com/repos/${repo}/pulls`);
    url.searchParams.set('state', 'all');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');
    url.searchParams.set('per_page', '100');

    logger.debug(`Fetching pull requests from ${repo}`, {
      endpoint: url.toString(),
      sinceFilter: since ? since.toISOString() : 'none',
    });

    const prs = await withExponentialRetry(async () => {
      const response = await fetchWithTimeout(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'coworker-bot-watcher',
        },
      });

      if (!response.ok) {
        if (response.status === 409) {
          throw response;
        }
        logger.error(
          `GitHub API error for ${repo}/pulls: ${response.status} ${response.statusText}`
        );
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    });

    const items: GitHubItem[] = [];

    for (const pr of prs as Array<{
      id: number;
      number: number;
      title?: string;
      updated_at: string;
    }>) {
      if (since && new Date(pr.updated_at) <= since) {
        logger.debug(`Skipping PR #${pr.number} (not updated since last poll)`);
        continue;
      }

      logger.debug(`Processing PR #${pr.number} from ${repo}`, {
        title: pr.title,
        updatedAt: pr.updated_at,
      });

      items.push({
        repository: repo,
        type: 'pull_request',
        number: pr.number,
        data: pr,
      });
    }

    logger.debug(`Collected ${items.length} pull requests from ${repo}`);
    return items;
  }
}
