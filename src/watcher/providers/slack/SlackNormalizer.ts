import type { NormalizedEvent } from '../../types/index.js';

export interface SlackFile {
  id: string;
  name: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  url_private?: string;
  permalink?: string;
}

export interface SlackEventPayload {
  type: string;
  event?: {
    type: string;
    channel: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
    channel_type?: string;
    files?: SlackFile[];
  };
  team_id?: string;
  event_id?: string;
  event_time?: number;
}

export function normalizeWebhookEvent(
  payload: SlackEventPayload,
  history?: string,
  actorEmail?: string,
  actorUsername?: string
): NormalizedEvent {
  const event = payload.event!;
  const eventId = `slack:${event.channel}:${event.ts}:${payload.event_id || Date.now()}`;
  const channelId = event.channel;
  const displayName = actorUsername || event.user;

  const resource: NormalizedEvent['resource'] = {
    number: 0,
    title: `your request`,
    description: history || event.text || '',
    url: '',
    state: 'open',
    repository: channelId,
    author: displayName,
    comment: {
      body: event.text || '',
      author: displayName,
    },
  };

  const actor: NormalizedEvent['actor'] = {
    username: displayName,
    id: event.user,
  };
  if (actorEmail) actor.email = actorEmail;

  return {
    id: eventId,
    provider: 'slack',
    type: 'message',
    action: 'created',
    resource,
    actor,
    metadata: {
      timestamp: event.ts,
      channel: channelId,
      threadTs: event.thread_ts,
      channelType: event.channel_type,
      ...(event.files?.length ? { files: event.files } : {}),
    },
    raw: payload,
  };
}

export function normalizePolledMention(
  mention: {
    channel: string;
    ts: string;
    threadTs?: string;
    text: string;
    user: string;
    permalink?: string;
    files?: SlackFile[];
  },
  history?: string,
  actorEmail?: string,
  actorUsername?: string
): NormalizedEvent {
  const eventId = `slack:${mention.channel}:${mention.ts}:polled`;
  const displayName = actorUsername || mention.user;

  const commentObj: { body: string; author: string; url?: string } = {
    body: mention.text || '',
    author: displayName,
  };

  if (mention.permalink) {
    commentObj.url = mention.permalink;
  }

  const resource: NormalizedEvent['resource'] = {
    number: 0,
    title: `your request`,
    description: history || mention.text || '',
    url: mention.permalink || '',
    state: 'open',
    repository: mention.channel,
    author: displayName,
    comment: commentObj,
  };

  const actor: NormalizedEvent['actor'] = {
    username: displayName,
    id: mention.user,
  };
  if (actorEmail) actor.email = actorEmail;

  return {
    id: eventId,
    provider: 'slack',
    type: 'message',
    action: 'created',
    resource,
    actor,
    metadata: {
      timestamp: mention.ts,
      channel: mention.channel,
      threadTs: mention.threadTs,
      polled: true,
      ...(mention.files?.length ? { files: mention.files } : {}),
    },
    raw: mention,
  };
}
