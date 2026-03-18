import type { NormalizedEvent } from '../../types/index.js';

export interface JiraUser {
  self?: string;
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraIssueFields {
  summary: string;
  description?: unknown; // ADF object or plain string
  // status and project are present in issue webhook payloads and search results,
  // but absent in the minimal issue stub embedded in comment webhook payloads.
  status?: {
    name: string;
    statusCategory?: { key: string; name: string };
  };
  project?: {
    key: string;
    name: string;
    id?: string;
  };
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  labels?: string[];
  issuetype?: { name: string };
  priority?: { name: string };
  // created and updated are Unix epoch milliseconds (integer) in issue fields,
  // consistent with the search/jql sample response ("updated": 1).
  // This differs from comment/worklog date fields which use ISO 8601 strings.
  created?: number;
  updated?: number;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

export interface JiraComment {
  id: string;
  self: string;
  author: JiraUser;
  body: unknown; // ADF object or plain string
  created: string;
  updated?: string;
}

export interface JiraWebhookPayload {
  timestamp: number;
  webhookEvent: string;
  issue_event_type_name?: string;
  user?: JiraUser;
  issue?: JiraIssue;
  comment?: JiraComment;
  changelog?: {
    items: Array<{
      field: string;
      fieldtype: string;
      from?: string;
      fromString?: string;
      to?: string;
      toString?: string;
    }>;
  };
}

/**
 * Extract plain text from Atlassian Document Format (ADF) or a plain string.
 * Handles nested ADF nodes and inline elements like mentions.
 */
export function extractTextFromADF(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const node = content as Record<string, unknown>;

  switch (node['type']) {
    case 'text':
      return (node['text'] as string) || '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      // ADF mentions carry their rendered text in attrs.text (e.g. "@Bot Name")
      return ((node['attrs'] as Record<string, unknown>)?.['text'] as string) || '@unknown';
    case 'emoji':
      return ((node['attrs'] as Record<string, unknown>)?.['text'] as string) || '';
    default:
      break;
  }

  if (node['content'] && Array.isArray(node['content'])) {
    const childText = (node['content'] as unknown[]).map(extractTextFromADF).join('');
    // Add a newline after block-level nodes so paragraphs are separated
    const blockTypes = new Set([
      'paragraph',
      'heading',
      'bulletList',
      'orderedList',
      'listItem',
      'blockquote',
      'codeBlock',
      'rule',
    ]);
    const suffix = blockTypes.has(node['type'] as string) ? '\n' : '';
    return childText + suffix;
  }

  return '';
}

/**
 * Extract the numeric part from a Jira issue key (e.g. "PROJ-123" → 123).
 */
function extractIssueNumber(key: string): number {
  const match = key.match(/-(\d+)$/);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

/**
 * Extract the project key from a Jira issue key (e.g. "PROJ-123" → "PROJ").
 * Used as a fallback when fields.project is absent (e.g. in comment webhook payloads).
 */
function extractProjectKey(issueKey: string): string {
  const match = issueKey.match(/^([A-Z][A-Z0-9_]*)-\d+$/);
  return match?.[1] ?? issueKey;
}

/**
 * Build a Jira browse URL from the REST API self URL and issue key.
 * e.g. "https://company.atlassian.net/rest/api/3/issue/10001" + "PROJ-123"
 *   → "https://company.atlassian.net/browse/PROJ-123"
 */
function buildBrowseUrl(issueSelf: string, issueKey: string): string {
  const match = issueSelf.match(/^(https?:\/\/[^/]+)/);
  if (match) {
    return `${match[1]}/browse/${issueKey}`;
  }
  return issueSelf;
}

export function normalizeWebhookIssueEvent(
  payload: JiraWebhookPayload,
  deliveryId: string
): NormalizedEvent {
  const issue = payload.issue!;
  const fields = issue.fields;
  const projectKey = fields.project?.key ?? extractProjectKey(issue.key);
  const eventId = `jira:${projectKey}:${payload.webhookEvent}:${issue.key}:${deliveryId}`;

  const description = extractTextFromADF(fields.description);
  const assignees = fields.assignee ? [fields.assignee] : undefined;
  const labels = fields.labels && fields.labels.length > 0 ? fields.labels : undefined;

  const resource: NormalizedEvent['resource'] = {
    number: extractIssueNumber(issue.key),
    title: fields.summary,
    description,
    url: buildBrowseUrl(issue.self, issue.key),
    state: fields.status?.name ?? 'unknown',
    repository: fields.project?.key ?? extractProjectKey(issue.key),
  };

  if (fields.reporter?.displayName) resource.author = fields.reporter.displayName;
  if (assignees) resource.assignees = assignees;
  if (labels) resource.labels = labels;

  const actor = payload.user ?? fields.reporter;

  return {
    id: eventId,
    provider: 'jira',
    type: 'issue',
    action: payload.issue_event_type_name ?? payload.webhookEvent,
    resource,
    actor: {
      username: actor?.displayName ?? 'unknown',
      id: actor?.accountId ?? 'unknown',
    },
    metadata: {
      timestamp: new Date(payload.timestamp).toISOString(),
      deliveryId,
      issueKey: issue.key,
    },
    raw: payload,
  };
}

export function normalizeWebhookCommentEvent(
  payload: JiraWebhookPayload,
  deliveryId: string
): NormalizedEvent {
  const issue = payload.issue!;
  const comment = payload.comment!;
  const fields = issue.fields;
  const projectKey = fields.project?.key ?? extractProjectKey(issue.key);
  const eventId = `jira:${projectKey}:comment:${comment.id}:${deliveryId}`;

  const description = extractTextFromADF(fields.description);
  const commentBody = extractTextFromADF(comment.body);
  const assignees = fields.assignee ? [fields.assignee] : undefined;

  const resource: NormalizedEvent['resource'] = {
    number: extractIssueNumber(issue.key),
    title: fields.summary,
    description,
    url: buildBrowseUrl(issue.self, issue.key),
    // status and project are absent in the minimal issue stub sent with comment webhooks
    state: fields.status?.name ?? 'unknown',
    repository: fields.project?.key ?? extractProjectKey(issue.key),
    comment: {
      body: commentBody,
      author: comment.author.displayName,
      url: comment.self,
    },
  };

  if (assignees) resource.assignees = assignees;

  return {
    id: eventId,
    provider: 'jira',
    type: 'issue',
    action: 'comment',
    resource,
    actor: {
      username: comment.author.displayName,
      id: comment.author.accountId,
    },
    metadata: {
      timestamp: new Date(payload.timestamp).toISOString(),
      deliveryId,
      issueKey: issue.key,
    },
    raw: payload,
  };
}

export function normalizePolledIssue(issue: JiraIssue): NormalizedEvent {
  const fields = issue.fields;
  const projectKey = fields.project?.key ?? extractProjectKey(issue.key);
  const eventId = `jira:${projectKey}:poll:${issue.key}:${Date.now()}`;

  const description = extractTextFromADF(fields.description);
  const assignees = fields.assignee ? [fields.assignee] : undefined;
  const labels = fields.labels && fields.labels.length > 0 ? fields.labels : undefined;

  const resource: NormalizedEvent['resource'] = {
    number: extractIssueNumber(issue.key),
    title: fields.summary,
    description,
    url: buildBrowseUrl(issue.self, issue.key),
    state: fields.status?.name ?? 'unknown',
    repository: fields.project?.key ?? extractProjectKey(issue.key),
  };

  if (fields.reporter?.displayName) resource.author = fields.reporter.displayName;
  if (assignees) resource.assignees = assignees;
  if (labels) resource.labels = labels;

  return {
    id: eventId,
    provider: 'jira',
    type: 'issue',
    action: 'poll',
    resource,
    actor: {
      username: fields.reporter?.displayName ?? 'unknown',
      id: fields.reporter?.accountId ?? 'unknown',
    },
    metadata: {
      timestamp: new Date().toISOString(),
      polled: true,
      issueKey: issue.key,
    },
    raw: issue,
  };
}
