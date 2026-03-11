export class WatcherError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'WatcherError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ProviderError extends WatcherError {
  constructor(
    message: string,
    public readonly provider: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = 'ProviderError';
  }
}

export class ConfigError extends WatcherError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ConfigError';
  }
}
