import type { NormalizedEvent } from '../../types/index.js';

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
