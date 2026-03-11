import { logger } from '../../utils/logger.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

interface GitLabPollerConfig {
  token: string;
  projects: string[];
  events?: string[];
  initialLookbackHours?: number;
  maxItemsPerPoll?: number;
  baseUrl?: string;
}

interface GitLabItem {
  type: 'issue' | 'merge_request';
  project: string;
  number: number;
  data: any;
}

export class GitLabPoller {
  private lastPoll: Map<string, Date> = new Map();
  private readonly baseUrl: string;

  constructor(private readonly config: GitLabPollerConfig) {
    this.baseUrl = config.baseUrl || 'https://gitlab.com/api/v4';
  }

  async poll(): Promise<GitLabItem[]> {
    const allItems: GitLabItem[] = [];

    for (const project of this.config.projects) {
      const items = await this.pollProject(project);
      allItems.push(...items);

      // Apply max items limit if configured
      if (this.config.maxItemsPerPoll && allItems.length >= this.config.maxItemsPerPoll) {
        logger.debug(`Reached max items per poll: ${this.config.maxItemsPerPoll}`);
        return allItems.slice(0, this.config.maxItemsPerPoll);
      }
    }

    return allItems;
  }

  private async pollProject(project: string): Promise<GitLabItem[]> {
    const items: GitLabItem[] = [];

    let since = this.lastPoll.get(project);

    if (!since) {
      const lookbackHours = this.config.initialLookbackHours ?? 1;
      since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      logger.info(`First poll for ${project}, looking back ${lookbackHours} hour(s)`);
    }

    const shouldPollIssues = !this.config.events || this.config.events.includes('issue');
    const shouldPollMRs = !this.config.events || this.config.events.includes('merge_request');

    try {
      if (shouldPollIssues) {
        const issues = await this.fetchIssues(project, since);
        logger.debug(`Found ${issues.length} issues for ${project}`);
        items.push(...issues);
      }

      if (shouldPollMRs) {
        const mrs = await this.fetchMergeRequests(project, since);
        logger.debug(`Found ${mrs.length} merge requests for ${project}`);
        items.push(...mrs);
      }

      this.lastPoll.set(project, new Date());
    } catch (error) {
      logger.error(`Error polling project ${project}`, error);
    }

    return items;
  }

  private async fetchIssues(project: string, since: Date): Promise<GitLabItem[]> {
    const encodedProject = encodeURIComponent(project);
    const url = `${this.baseUrl}/projects/${encodedProject}/issues?updated_after=${since.toISOString()}&order_by=updated_at&sort=asc`;

    logger.debug(`Polling GitLab issues: ${url}`);

    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch issues: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const issues = data as any[];
    const items: GitLabItem[] = [];

    for (const issue of issues) {
      // Filter by updated_at
      if (since && new Date(issue.updated_at) <= since) {
        logger.debug(`Skipping issue #${issue.iid} (not updated since last poll)`);
        continue;
      }

      items.push({
        type: 'issue',
        project,
        number: issue.iid,
        data: issue,
      });
    }

    return items;
  }

  private async fetchMergeRequests(project: string, since: Date): Promise<GitLabItem[]> {
    const encodedProject = encodeURIComponent(project);
    const url = `${this.baseUrl}/projects/${encodedProject}/merge_requests?updated_after=${since.toISOString()}&order_by=updated_at&sort=asc`;

    logger.debug(`Polling GitLab merge requests: ${url}`);

    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch merge requests: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const mrs = data as any[];
    const items: GitLabItem[] = [];

    for (const mr of mrs) {
      // Filter by updated_at
      if (since && new Date(mr.updated_at) <= since) {
        logger.debug(`Skipping merge request !${mr.iid} (not updated since last poll)`);
        continue;
      }

      items.push({
        type: 'merge_request',
        project,
        number: mr.iid,
        data: mr,
      });
    }

    return items;
  }
}
