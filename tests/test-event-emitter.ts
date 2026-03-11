import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WatcherEventEmitter } from '../src/watcher/core/EventEmitter.js';

test('WatcherEventEmitter - emits "event" with provider name and payload', () => {
  const emitter = new WatcherEventEmitter();
  let receivedProvider: string | undefined;
  let receivedEvent: unknown;

  emitter.on('event', (provider, event) => {
    receivedProvider = provider;
    receivedEvent = event;
  });

  emitter.emit('event', 'github', { type: 'issue' });
  assert.equal(receivedProvider, 'github');
  assert.deepEqual(receivedEvent, { type: 'issue' });
});

test('WatcherEventEmitter - emits "error" event with the error object', () => {
  const emitter = new WatcherEventEmitter();
  let receivedError: Error | undefined;

  emitter.on('error', (err) => {
    receivedError = err;
  });

  const error = new Error('test error');
  emitter.emit('error', error);
  assert.equal(receivedError, error);
});

test('WatcherEventEmitter - emits "started" event', () => {
  const emitter = new WatcherEventEmitter();
  let started = false;

  emitter.on('started', () => {
    started = true;
  });

  emitter.emit('started');
  assert.equal(started, true);
});

test('WatcherEventEmitter - emits "stopped" event', () => {
  const emitter = new WatcherEventEmitter();
  let stopped = false;

  emitter.on('stopped', () => {
    stopped = true;
  });

  emitter.emit('stopped');
  assert.equal(stopped, true);
});

test('WatcherEventEmitter - "once" listener fires exactly once', () => {
  const emitter = new WatcherEventEmitter();
  let count = 0;

  emitter.once('started', () => {
    count++;
  });

  emitter.emit('started');
  emitter.emit('started');
  emitter.emit('started');
  assert.equal(count, 1);
});

test('WatcherEventEmitter - "off" removes a registered listener', () => {
  const emitter = new WatcherEventEmitter();
  let count = 0;
  const listener = () => {
    count++;
  };

  emitter.on('started', listener);
  emitter.emit('started');
  emitter.off('started', listener);
  emitter.emit('started');
  assert.equal(count, 1);
});

test('WatcherEventEmitter - multiple listeners on the same event all fire', () => {
  const emitter = new WatcherEventEmitter();
  const received: string[] = [];

  emitter.on('event', (provider) => received.push(`A:${provider}`));
  emitter.on('event', (provider) => received.push(`B:${provider}`));

  emitter.emit('event', 'gitlab', {});
  assert.deepEqual(received, ['A:gitlab', 'B:gitlab']);
});
