import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SlackComments } from '../../../src/watcher/providers/slack/SlackComments.js';

test('SlackComments getConversationHistory falls back to attachment blocks when text is empty', async () => {
  const comments = new SlackComments('xoxb-test-token') as SlackComments & {
    getReplies: (channel: string, ts: string) => Promise<any[]>;
  };

  comments.getReplies = async () => [
    {
      ts: '1776804878.408499',
      text: '',
      user: '',
      attachments: [
        {
          blocks: [
            {
              type: 'header',
              text: { text: 'ATTACHMENT-BLOCK-REPRO-1776804878' },
            },
            {
              type: 'section',
              text: { text: '*Attachment-block repro*' },
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: 'Trying attachment block fallback.' }],
            },
          ],
        },
      ],
    },
  ];

  const history = await comments.getConversationHistory('C08S4K5LQKX', '1776804878.408499');

  assert.equal(
    history,
    '[1776804878.408499] unknown: ATTACHMENT-BLOCK-REPRO-1776804878\n*Attachment-block repro*\nTrying attachment block fallback.'
  );
});

test('SlackComments getConversationHistory preserves message text when present', async () => {
  const comments = new SlackComments('xoxb-test-token') as SlackComments & {
    getReplies: (channel: string, ts: string) => Promise<any[]>;
  };

  comments.getReplies = async () => [
    {
      ts: '1776804917.480769',
      text: 'existing message text',
      user: 'U08MXKSNP5M',
      attachments: [
        {
          blocks: [
            {
              type: 'section',
              text: { text: 'ignored block text' },
            },
          ],
        },
      ],
    },
  ];

  const history = await comments.getConversationHistory('C08S4K5LQKX', '1776804878.408499');

  assert.equal(history, '[1776804917.480769] <@U08MXKSNP5M>: existing message text');
});

test('SlackComments getConversationHistory falls back to legacy attachment fields when text is empty', async () => {
  const comments = new SlackComments('xoxb-test-token') as SlackComments & {
    getReplies: (channel: string, ts: string) => Promise<any[]>;
  };

  comments.getReplies = async () => [
    {
      ts: '1776453275.180619',
      text: '',
      bot_id: 'B06V1PV9Z9Q',
      attachments: [
        {
          fields: [
            {
              title: '[Still Failing] banking-platform-release (main) #8359',
              value:
                'fix(grpc): [NOLINEAR] correct InternalReceiptsServiceV2 kt_client address routing (#299231)\n<https://buildkite.com/brex/banking-platform-release/builds/8359|View Build>',
            },
          ],
          fallback: 'fallback text that should not be used when fields are present',
        },
      ],
    },
  ];

  const history = await comments.getConversationHistory('C06UM7C51GX', '1776453275.180619');

  assert.equal(
    history,
    '[1776453275.180619] <bot:B06V1PV9Z9Q>: [Still Failing] banking-platform-release (main) #8359\nfix(grpc): [NOLINEAR] correct InternalReceiptsServiceV2 kt_client address routing (#299231)\n<https://buildkite.com/brex/banking-platform-release/builds/8359|View Build>'
  );
});
