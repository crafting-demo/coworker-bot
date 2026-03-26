import type { NormalizedEvent } from '../../types/index.js';

export interface GitHubStatusPayload {
  state: 'pending' | 'success' | 'failure' | 'error';
  sha: string;
  context: string;
  description: string | null;
  target_url: string | null;
  repository: {
    full_name: string;
  };
  sender: {
    id: number;
    login: string;
  };
  // id is used to build a unique event id
  id: number;
}

export interface GitHubCheckRunPayload {
  action: string;
  check_run: {
    id: number;
    name: string;
    html_url: string;
    conclusion: string | null;
    head_sha: string;
    pull_requests: Array<{
      number: number;
      head: { ref: string };
      base: { ref: string };
    }>;
    output?: {
      title?: string | null;
      summary?: string | null;
    };
    app?: {
      name?: string;
    };
  };
  repository: {
    full_name: string;
  };
  sender: {
    id: number;
    login: string;
  };
}

export interface GitHubWebhookPayload {
  action: string;
  issue?: {
    id: number;
    number: number;
    title: string;
    body?: string;
    html_url: string;
    state: string;
    assignees?: any[];
    labels?: any[];
    user?: { login: string; id: number };
    pull_request?: unknown;
  };
  pull_request?: {
    id: number;
    number: number;
    title: string;
    body?: string;
    html_url: string;
    state: string;
    merged?: boolean;
    assignees?: any[];
    labels?: any[];
    user?: { login: string; id: number };
    head?: { ref: string };
    base?: { ref: string };
  };
  comment?: {
    id: number;
    body?: string;
    html_url?: string;
    user?: { login: string; id: number };
  };
  repository: {
    full_name: string;
  };
  sender: {
    id: number;
    login: string;
  };
}

export function normalizeWebhookEvent(
  payload: GitHubWebhookPayload,
  deliveryId: string
): NormalizedEvent {
  let type = 'issue';
  let eventId = '';
  let number = 0;
  let title = '';
  let description = '';
  let url = '';
  let state = '';
  let author: string | undefined;
  let assignees: unknown[] | undefined;
  let labels: string[] | undefined;
  let branch: string | undefined;
  let mergeTo: string | undefined;
  let comment: { body: string; author: string; url?: string } | undefined;

  if (payload.pull_request) {
    type = 'pull_request';
    const pr = payload.pull_request;
    eventId = `github:${payload.repository.full_name}:${payload.action}:${pr.id}:${deliveryId}`;
    number = pr.number;
    title = pr.title;
    description = pr.body || '';
    url = pr.html_url;
    state = pr.state;
    author = pr.user?.login;
    assignees = pr.assignees && pr.assignees.length > 0 ? pr.assignees : undefined;
    labels = pr.labels?.map((l: any) => l.name);
    branch = pr.head?.ref;
    mergeTo = pr.base?.ref;
  } else if (payload.issue) {
    type = 'issue';
    const issue = payload.issue;
    eventId = `github:${payload.repository.full_name}:${payload.action}:${issue.id}:${deliveryId}`;
    number = issue.number;
    title = issue.title;
    description = issue.body || '';
    url = issue.html_url;
    state = issue.state;
    author = issue.user?.login;
    assignees = issue.assignees && issue.assignees.length > 0 ? issue.assignees : undefined;
    labels = issue.labels?.map((l: any) => l.name);

    if (issue.pull_request) {
      type = 'pull_request';
    }
  }

  if (payload.comment) {
    const commentObj: { body: string; author: string; url?: string } = {
      body: payload.comment.body || '',
      author: payload.comment.user?.login || 'unknown',
    };
    if (payload.comment.html_url) {
      commentObj.url = payload.comment.html_url;
    }
    comment = commentObj;
    eventId = `github:${payload.repository.full_name}:${payload.action}:comment:${payload.comment.id}:${deliveryId}`;
  }

  const resource: NormalizedEvent['resource'] = {
    number,
    title,
    description,
    url,
    state,
    repository: payload.repository.full_name,
  };

  if (author) resource.author = author;
  if (assignees) resource.assignees = assignees;
  if (labels) resource.labels = labels;
  if (branch) resource.branch = branch;
  if (mergeTo) resource.mergeTo = mergeTo;
  if (comment) resource.comment = comment;

  return {
    id: eventId,
    provider: 'github',
    type,
    action: payload.action,
    resource,
    actor: {
      username: payload.sender?.login || 'unknown',
      id: payload.sender?.id || 0,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      deliveryId,
    },
    raw: payload,
  };
}

export function normalizePolledEvent(item: {
  repository: string;
  type: string;
  data: any;
}): NormalizedEvent {
  const data = item.data;
  const type = item.type;
  const eventId = `github:${item.repository}:poll:${data.number}:${Date.now()}`;

  const resource: NormalizedEvent['resource'] = {
    number: data.number,
    title: data.title,
    description: data.body || '',
    url: data.html_url,
    state: data.state,
    repository: item.repository,
  };

  const author = data.user?.login;
  const assignees = data.assignees && data.assignees.length > 0 ? data.assignees : undefined;
  const labels = data.labels?.map((l: any) => l.name);
  const branch = type === 'pull_request' && data.head ? data.head.ref : undefined;
  const mergeTo = type === 'pull_request' && data.base ? data.base.ref : undefined;

  if (author) resource.author = author;
  if (assignees) resource.assignees = assignees;
  if (labels) resource.labels = labels;
  if (branch) resource.branch = branch;
  if (mergeTo) resource.mergeTo = mergeTo;

  return {
    id: eventId,
    provider: 'github',
    type,
    action: 'poll',
    resource,
    actor: {
      username: data.user?.login || 'unknown',
      id: data.user?.id || 0,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      polled: true,
    },
    raw: data,
  };
}

/**
 * Normalizes a check_run webhook event into a NormalizedEvent targeting the associated PR.
 *
 * @param payload  The check_run webhook payload.
 * @param pr       The associated pull request (number, head/base branch). Callers must
 *                 supply enriched PR data (title, description, url, labels) fetched
 *                 from the GitHub API so the normalized event is fully populated.
 * @param deliveryId  GitHub delivery ID for event uniqueness.
 */
export function normalizeCheckRunEvent(
  payload: GitHubCheckRunPayload,
  pr: {
    number: number;
    title: string;
    description: string;
    url: string;
    state: string;
    author?: string;
    labels?: string[];
    branch: string;
    mergeTo: string;
  },
  deliveryId: string
): NormalizedEvent {
  const checkRun = payload.check_run;
  const eventId = `github:${payload.repository.full_name}:check_run:${checkRun.id}:${deliveryId}`;

  const resource: NormalizedEvent['resource'] = {
    number: pr.number,
    title: pr.title,
    description: pr.description,
    url: pr.url,
    state: pr.state,
    repository: payload.repository.full_name,
    branch: pr.branch,
    mergeTo: pr.mergeTo,
    check: {
      name: checkRun.name,
      conclusion: checkRun.conclusion ?? 'failure',
      url: checkRun.html_url,
      ...(checkRun.output && (checkRun.output.title || checkRun.output.summary)
        ? {
            output: {
              ...(checkRun.output.title ? { title: checkRun.output.title } : {}),
              ...(checkRun.output.summary ? { summary: checkRun.output.summary } : {}),
            },
          }
        : {}),
    },
  };

  if (pr.author) resource.author = pr.author;
  if (pr.labels && pr.labels.length > 0) resource.labels = pr.labels;

  return {
    id: eventId,
    provider: 'github',
    type: 'pull_request',
    action: 'check_failed',
    resource,
    actor: {
      username: payload.sender?.login || 'unknown',
      id: payload.sender?.id || 0,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      deliveryId,
    },
    raw: payload,
  };
}

/**
 * Normalizes a commit status webhook event (legacy status API, used by e.g. Buildkite OAuth mode)
 * into a NormalizedEvent targeting the associated PR.
 *
 * @param payload  The status webhook payload.
 * @param pr       Enriched PR data fetched from the GitHub API.
 * @param deliveryId  GitHub delivery ID for event uniqueness.
 */
export function normalizeStatusEvent(
  payload: GitHubStatusPayload,
  pr: {
    number: number;
    title: string;
    description: string;
    url: string;
    state: string;
    author?: string;
    labels?: string[];
    branch: string;
    mergeTo: string;
  },
  deliveryId: string
): NormalizedEvent {
  const eventId = `github:${payload.repository.full_name}:status:${payload.id}:${deliveryId}`;

  const resource: NormalizedEvent['resource'] = {
    number: pr.number,
    title: pr.title,
    description: pr.description,
    url: pr.url,
    state: pr.state,
    repository: payload.repository.full_name,
    branch: pr.branch,
    mergeTo: pr.mergeTo,
    check: {
      name: payload.context,
      conclusion: payload.state,
      url: payload.target_url ?? pr.url,
      ...(payload.description ? { output: { summary: payload.description } } : {}),
    },
  };

  if (pr.author) resource.author = pr.author;
  if (pr.labels && pr.labels.length > 0) resource.labels = pr.labels;

  return {
    id: eventId,
    provider: 'github',
    type: 'pull_request',
    action: 'check_failed',
    resource,
    actor: {
      username: payload.sender?.login || 'unknown',
      id: payload.sender?.id || 0,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      deliveryId,
    },
    raw: payload,
  };
}
