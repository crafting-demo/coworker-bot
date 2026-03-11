import { EventEmitter as NodeEventEmitter } from 'events';

export interface WatcherEvents {
  event: (provider: string, event: unknown) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

export class WatcherEventEmitter extends NodeEventEmitter {
  on<K extends keyof WatcherEvents>(event: K, listener: WatcherEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof WatcherEvents>(event: K, ...args: Parameters<WatcherEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  once<K extends keyof WatcherEvents>(event: K, listener: WatcherEvents[K]): this {
    return super.once(event, listener);
  }

  off<K extends keyof WatcherEvents>(event: K, listener: WatcherEvents[K]): this {
    return super.off(event, listener);
  }
}
