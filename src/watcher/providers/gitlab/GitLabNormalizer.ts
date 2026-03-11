import type { NormalizedEvent } from '../../types/index.js';

// Label object structure in GitLab webhook payloads
interface GitLabLabelObject {
  id: number;
  title: string;
  color: string;
  project_id: number | null;
  created_at: string;
  updated_at: string;
  template: boolean;
  description: string | null;
  type: string;
  group_id: number | null;
}

// User object structure in GitLab webhook payloads
interface GitLabUserObject {
  id: number;
  name: string;
  username: string;
  avatar_url: string;
  email?: string;
}

// Project object in GitLab webhook payloads
interface GitLabProjectObject {
  id: number;
  name: string;
  description: string | null;
  web_url: string;
  avatar_url: string | null;
  git_ssh_url: string;
  git_http_url: string;
  namespace: string;
  visibility_level: number;
  path_with_namespace: string;
  default_branch: string;
  ci_config_path: string | null;
  homepage?: string;
  url?: string;
  ssh_url?: string;
  http_url?: string;
}

// object_attributes for issue / merge_request events
interface GitLabIssueAttributes {
  id: number;
  iid: number;
  title: string;
  description?: string;
  url: string;
  state: string;
  action?: string;
  author_id?: number;
  assignee_ids?: number[];
  assignee_id?: number | null;
  project_id?: number;
  created_at: string;
  updated_at: string;
  source_branch?: string;
  target_branch?: string;
  labels?: GitLabLabelObject[];
}

// object_attributes for note (comment) events
interface GitLabNoteAttributes {
  id: number;
  note: string;
  noteable_type: string;
  author_id: number;
  created_at: string;
  updated_at: string;
  project_id: number;
  noteable_id: number;
  system: boolean;
  internal: boolean;
  attachment: string | null;
  line_code: string | null;
  commit_id: string;
  st_diff: unknown | null;
  action: string;
  url: string;
}

export interface GitLabWebhookPayload {
  object_kind: 'issue' | 'merge_request' | 'note' | string;
  event_type?: string;
  user?: GitLabUserObject;
  project: GitLabProjectObject;
  repository?: {
    name: string;
    url: string;
    description: string;
    homepage: string;
  };
  object_attributes: GitLabIssueAttributes | GitLabNoteAttributes;
  assignees?: GitLabUserObject[];
  assignee?: GitLabUserObject;
  labels?: GitLabLabelObject[];
  changes?: Record<string, unknown>;
  // Present on note events — sibling data for the parent resource
  issue?: {
    id: number;
    iid: number;
    title: string;
    description?: string;
    state: string;
    assignee_ids?: number[];
    assignee_id?: number | null;
    author_id: number;
    project_id: number;
    created_at: string;
    updated_at: string;
    labels?: GitLabLabelObject[];
  };
  merge_request?: {
    id: number;
    iid: number;
    title: string;
    description?: string;
    state: string;
    source_branch: string;
    target_branch: string;
    source_project_id: number;
    target_project_id: number;
    author_id: number;
    assignee_id?: number | null;
    merge_status: string;
    labels?: GitLabLabelObject[];
    assignee?: GitLabUserObject;
    source?: GitLabProjectObject;
    target?: GitLabProjectObject;
    last_commit?: {
      id: string;
      message: string;
      timestamp: string;
      url: string;
      author: { name: string; email: string };
    };
    work_in_progress?: boolean;
    draft?: boolean;
    detailed_merge_status?: string;
  };
}

export function normalizeWebhookEvent(payload: GitLabWebhookPayload): NormalizedEvent {
  if (payload.object_kind === 'note') {
    return normalizeNoteEvent(payload);
  }
  return normalizeIssueOrMREvent(payload);
}

function normalizeIssueOrMREvent(payload: GitLabWebhookPayload): NormalizedEvent {
  const attrs = payload.object_attributes as GitLabIssueAttributes;
  const projectId = payload.project.path_with_namespace;
  const type = payload.object_kind === 'merge_request' ? 'merge_request' : 'issue';
  const eventId = `gitlab:${projectId}:${attrs.action || 'update'}:${attrs.id}:${Date.now()}`;

  const resource: NormalizedEvent['resource'] = {
    number: attrs.iid,
    title: attrs.title,
    description: attrs.description || '',
    url: attrs.url,
    state: attrs.state,
    repository: projectId,
  };

  const author = payload.user?.username;
  const assignees = payload.assignees?.length ? payload.assignees : undefined;
  const labels = payload.labels?.map((l) => l.title) || attrs.labels?.map((l) => l.title);
  const branch = attrs.source_branch;
  const mergeTo = attrs.target_branch;

  if (author) resource.author = author;
  if (assignees && assignees.length > 0) resource.assignees = assignees;
  if (labels && labels.length > 0) resource.labels = labels;
  if (branch) resource.branch = branch;
  if (mergeTo) resource.mergeTo = mergeTo;

  return {
    id: eventId,
    provider: 'gitlab',
    type,
    action: attrs.action || 'update',
    resource,
    actor: {
      username: payload.user?.username || 'unknown',
      id: payload.user?.id || 0,
    },
    metadata: {
      timestamp: new Date().toISOString(),
    },
    raw: payload,
  };
}

function normalizeNoteEvent(payload: GitLabWebhookPayload): NormalizedEvent {
  const attrs = payload.object_attributes as GitLabNoteAttributes;
  const projectId = payload.project.path_with_namespace;
  const hasMR = !!payload.merge_request;
  const type = hasMR ? 'merge_request' : 'issue';
  const noteable = payload.merge_request || payload.issue;
  const eventId = `gitlab:${projectId}:note:${attrs.id}:${Date.now()}`;

  // Strip the #note_NNN fragment to get the parent resource URL
  const resourceUrl = attrs.url.split('#')[0] ?? '';

  const resource: NormalizedEvent['resource'] = {
    number: noteable?.iid || 0,
    title: noteable?.title || '',
    description: noteable?.description || '',
    url: resourceUrl,
    state: noteable?.state || 'open',
    repository: projectId,
    comment: {
      body: attrs.note,
      author: payload.user?.username || 'unknown',
      url: attrs.url,
    },
  };

  const labels = noteable?.labels?.map((l) => l.title);
  const branch = payload.merge_request?.source_branch;
  const mergeTo = payload.merge_request?.target_branch;

  if (labels && labels.length > 0) resource.labels = labels;
  if (branch) resource.branch = branch;
  if (mergeTo) resource.mergeTo = mergeTo;

  return {
    id: eventId,
    provider: 'gitlab',
    type,
    action: 'note',
    resource,
    actor: {
      username: payload.user?.username || 'unknown',
      id: payload.user?.id || 0,
    },
    metadata: {
      timestamp: new Date().toISOString(),
    },
    raw: payload,
  };
}

export function normalizePolledEvent(item: any): NormalizedEvent {
  const data = item.data;
  const type = item.type;
  const eventId = `gitlab:${item.project}:poll:${data.iid}:${Date.now()}`;

  const resource: NormalizedEvent['resource'] = {
    number: data.iid,
    title: data.title,
    description: data.description || '',
    url: data.web_url,
    state: data.state,
    repository: item.project,
  };

  const author = data.author?.username;
  const assignees = data.assignees;
  // GitLab REST API returns labels as an array of strings for issues/MRs
  const labels = data.labels?.map((l: string) => l);
  const branch = type === 'merge_request' && data.source_branch ? data.source_branch : undefined;
  const mergeTo = type === 'merge_request' && data.target_branch ? data.target_branch : undefined;

  if (author) resource.author = author;
  if (assignees && assignees.length > 0) resource.assignees = assignees;
  if (labels && labels.length > 0) resource.labels = labels;
  if (branch) resource.branch = branch;
  if (mergeTo) resource.mergeTo = mergeTo;

  return {
    id: eventId,
    provider: 'gitlab',
    type,
    action: 'poll',
    resource,
    actor: {
      username: data.author?.username || 'unknown',
      id: data.author?.id || 0,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      polled: true,
    },
    raw: data,
  };
}
