import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBotMentionedInText, isBotAssignedInList } from '../src/watcher/utils/eventFilter.js';

// --- isBotMentionedInText ---

test('isBotMentionedInText - @bot at start of body', () => {
  assert.equal(isBotMentionedInText('@bot please fix this', ['bot']), true);
});

test('isBotMentionedInText - @bot in middle of sentence', () => {
  assert.equal(isBotMentionedInText('hey @bot can you help?', ['bot']), true);
});

test('isBotMentionedInText - case-insensitive match', () => {
  assert.equal(isBotMentionedInText('hey @Bot can you help?', ['bot']), true);
});

test('isBotMentionedInText - @bot-extra does NOT match bot named "bot"', () => {
  assert.equal(isBotMentionedInText('@bot-extra please fix', ['bot']), false);
});

test('isBotMentionedInText - @other-bot does NOT match bot named "bot"', () => {
  assert.equal(isBotMentionedInText('@other-bot please fix', ['bot']), false);
});

test('isBotMentionedInText - bare username without @ does not match', () => {
  assert.equal(isBotMentionedInText('notabot please fix this', ['bot']), false);
});

test('isBotMentionedInText - empty body returns false', () => {
  assert.equal(isBotMentionedInText('', ['bot']), false);
});

test('isBotMentionedInText - empty botUsernames returns false', () => {
  assert.equal(isBotMentionedInText('@bot please fix', []), false);
});

test('isBotMentionedInText - hyphenated username matches exactly', () => {
  assert.equal(isBotMentionedInText('@coworker-bot-bot please fix this', ['coworker-bot-bot']), true);
});

test('isBotMentionedInText - @coworker-bot-bot-extra does NOT match "coworker-bot-bot"', () => {
  assert.equal(isBotMentionedInText('@coworker-bot-bot-extra', ['coworker-bot-bot']), false);
});

test('isBotMentionedInText - any bot in multi-bot list matches', () => {
  assert.equal(isBotMentionedInText('@backup-bot fix this', ['main-bot', 'backup-bot']), true);
});

test('isBotMentionedInText - no bot in list matches returns false', () => {
  assert.equal(isBotMentionedInText('@other-user fix this', ['main-bot', 'backup-bot']), false);
});

test('isBotMentionedInText - @bot at end of line with no trailing space', () => {
  assert.equal(isBotMentionedInText('please help @bot', ['bot']), true);
});

test('isBotMentionedInText - @bot followed by comma', () => {
  assert.equal(isBotMentionedInText('cc @bot, please review', ['bot']), true);
});

// --- isBotAssignedInList ---

test('isBotAssignedInList - matching login returns true', () => {
  const assignees = [{ login: 'bot-user', id: 1 }];
  assert.equal(
    isBotAssignedInList(assignees, ['bot-user'], (a) => (a as any).login),
    true
  );
});

test('isBotAssignedInList - no assignees (undefined) returns false', () => {
  assert.equal(
    isBotAssignedInList(undefined, ['bot-user'], (a) => (a as any).login),
    false
  );
});

test('isBotAssignedInList - empty assignees array returns false', () => {
  assert.equal(
    isBotAssignedInList([], ['bot-user'], (a) => (a as any).login),
    false
  );
});

test('isBotAssignedInList - non-matching login returns false', () => {
  const assignees = [{ login: 'alice', id: 1 }];
  assert.equal(
    isBotAssignedInList(assignees, ['bot-user'], (a) => (a as any).login),
    false
  );
});

test('isBotAssignedInList - empty botUsernames returns false', () => {
  const assignees = [{ login: 'bot-user', id: 1 }];
  assert.equal(
    isBotAssignedInList(assignees, [], (a) => (a as any).login),
    false
  );
});

test('isBotAssignedInList - case-insensitive match', () => {
  const assignees = [{ login: 'Bot-User', id: 1 }];
  assert.equal(
    isBotAssignedInList(assignees, ['bot-user'], (a) => (a as any).login),
    true
  );
});

test('isBotAssignedInList - multiple assignees, one matching', () => {
  const assignees = [
    { login: 'alice', id: 1 },
    { login: 'bot-user', id: 2 },
  ];
  assert.equal(
    isBotAssignedInList(assignees, ['bot-user'], (a) => (a as any).login),
    true
  );
});

test('isBotAssignedInList - getUsernameFrom returns undefined for absent field', () => {
  // Assignee has no 'login' property — extractor returns undefined
  const assignees = [{ name: 'bot-user' }];
  assert.equal(
    isBotAssignedInList(assignees, ['bot-user'], (a) => (a as any).login),
    false
  );
});

test('isBotAssignedInList - works with username field (GitLab style)', () => {
  const assignees = [{ username: 'coworker-bot', id: 51 }];
  assert.equal(
    isBotAssignedInList(assignees, ['coworker-bot'], (a) => (a as any).username),
    true
  );
});

test('isBotAssignedInList - works with name field (Linear style)', () => {
  const assignees = [{ name: 'Auto Coder Bot', id: 'user-1' }];
  assert.equal(
    isBotAssignedInList(assignees, ['Auto Coder Bot'], (a) => (a as any).name),
    true
  );
});
