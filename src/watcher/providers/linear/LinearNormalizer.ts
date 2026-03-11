import type { NormalizedEvent } from '../../types/index.js';

export interface LinearCommentPayload {
  action: string;
  type: 'Comment';
  createdAt: string;
  organizationId?: string;
  webhookTimestamp?: number;
  actor?: {
    id: string;
    type: string;
    name: string;
    email?: string;
    url?: string;
  };
  data: {
    id: string;
    body: string;
    user?: { id?: string; name: string };
    issue: {
      id: string;
      identifier: string;
      number: number;
      title: string;
      description?: string;
      url: string;
      state: { name: string; type?: string };
      team: { key: string; name: string };
      assignee?: { id?: string; name: string };
      labels?: { nodes: Array<{ id?: string; name: string }> };
    };
    createdAt: string;
  };
}

export interface LinearWebhookPayload {
  action: string;
  type: string;
  createdAt: string;
  url?: string;
  organizationId?: string;
  webhookTimestamp?: number;
  actor?: {
    id: string;
    type: string;
    name: string;
    email?: string;
    url?: string;
  };
  data: {
    id: string;
    identifier: string;
    number: number;
    title: string;
    description?: string;
    url: string;
    state: {
      name: string;
      type?: string;
      color?: string;
    };
    team: {
      key: string;
      name: string;
    };
    assignee?: {
      id?: string;
      name: string;
    };
    creator?: {
      id?: string;
      name: string;
    };
    labels?: { nodes: Array<{ id?: string; name: string }> };
    updatedAt: string;
    createdAt: string;
  };
  updatedFrom?: {
    [key: string]: unknown;
  };
}

export function normalizeWebhookEvent(
  payload: LinearWebhookPayload,
  webhookId: string
): NormalizedEvent {
  const data = payload.data;
  const eventId = `linear:${data.team.key}:${payload.action}:${data.id}:${webhookId}`;

  const resource: NormalizedEvent['resource'] = {
    number: data.number,
    title: data.title,
    description: data.description || '',
    url: data.url,
    state: data.state.name,
    repository: data.team.key,
  };

  const author = data.creator?.name;
  const assignees = data.assignee ? [data.assignee] : undefined;
  const labels = data.labels?.nodes?.map((l) => l.name);

  if (author) resource.author = author;
  if (assignees) resource.assignees = assignees;
  if (labels && labels.length > 0) resource.labels = labels;

  return {
    id: eventId,
    provider: 'linear',
    type: 'issue',
    action: payload.action,
    resource,
    actor: {
      username: data.creator?.name || 'unknown',
      id: data.id,
    },
    metadata: {
      timestamp: payload.createdAt,
    },
    raw: payload,
  };
}

export function normalizeCommentEvent(
  payload: LinearCommentPayload,
  webhookId: string
): NormalizedEvent {
  const data = payload.data;
  const issue = data.issue;
  const eventId = `linear:${issue.team.key}:comment:${data.id}:${webhookId}`;

  const resource: NormalizedEvent['resource'] = {
    number: issue.number,
    title: issue.title,
    description: issue.description || '',
    url: issue.url,
    state: issue.state.name,
    repository: issue.team.key,
    comment: {
      body: data.body,
      author: data.user?.name || 'unknown',
    },
  };

  const assignees = issue.assignee ? [issue.assignee] : undefined;
  const labels = issue.labels?.nodes?.map((l) => l.name);

  if (assignees) resource.assignees = assignees;
  if (labels && labels.length > 0) resource.labels = labels;

  return {
    id: eventId,
    provider: 'linear',
    type: 'issue',
    action: 'comment',
    resource,
    actor: {
      username: payload.actor?.name || data.user?.name || 'unknown',
      id: data.id,
    },
    metadata: {
      timestamp: payload.createdAt,
    },
    raw: payload,
  };
}

export function normalizePolledEvent(item: any): NormalizedEvent {
  const data = item.data;
  const eventId = `linear:${item.team}:poll:${data.number}:${Date.now()}`;

  const resource: NormalizedEvent['resource'] = {
    number: data.number,
    title: data.title,
    description: data.description || '',
    url: data.url,
    state: data.state.name,
    repository: data.team.key,
  };

  const author = data.creator?.name;
  const assignees = data.assignee ? [data.assignee] : undefined;
  const labels = data.labels?.nodes?.map((l: any) => l.name);

  if (author) resource.author = author;
  if (assignees) resource.assignees = assignees;
  if (labels && labels.length > 0) resource.labels = labels;

  return {
    id: eventId,
    provider: 'linear',
    type: 'issue',
    action: 'poll',
    resource,
    actor: {
      username: data.creator?.name || 'unknown',
      id: data.id,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      polled: true,
    },
    raw: data,
  };
}
