import type { NormalizedEvent } from '../../types/index.js';

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
  };
  team_id?: string;
  event_id?: string;
  event_time?: number;
}

export function normalizeWebhookEvent(
  payload: SlackEventPayload,
  history?: string
): NormalizedEvent {
  const event = payload.event!;
  const eventId = `slack:${event.channel}:${event.ts}:${payload.event_id || Date.now()}`;
  const channelId = event.channel;

  const resource: NormalizedEvent['resource'] = {
    number: 0,
    title: `Message in #${channelId}`,
    description: history || event.text || '',
    url: '',
    state: 'open',
    repository: channelId,
    author: event.user,
    comment: {
      body: event.text || '',
      author: event.user,
    },
  };

  return {
    id: eventId,
    provider: 'slack',
    type: 'message',
    action: 'created',
    resource,
    actor: {
      username: event.user,
      id: event.user,
    },
    metadata: {
      timestamp: event.ts,
      channel: channelId,
      threadTs: event.thread_ts,
      channelType: event.channel_type,
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
  },
  history?: string
): NormalizedEvent {
  const eventId = `slack:${mention.channel}:${mention.ts}:polled`;

  const commentObj: { body: string; author: string; url?: string } = {
    body: mention.text || '',
    author: mention.user,
  };

  if (mention.permalink) {
    commentObj.url = mention.permalink;
  }

  const resource: NormalizedEvent['resource'] = {
    number: 0,
    title: `Message in #${mention.channel}`,
    description: history || mention.text || '',
    url: mention.permalink || '',
    state: 'open',
    repository: mention.channel,
    author: mention.user,
    comment: commentObj,
  };

  return {
    id: eventId,
    provider: 'slack',
    type: 'message',
    action: 'created',
    resource,
    actor: {
      username: mention.user,
      id: mention.user,
    },
    metadata: {
      timestamp: mention.ts,
      channel: mention.channel,
      threadTs: mention.threadTs,
      polled: true,
    },
    raw: mention,
  };
}
