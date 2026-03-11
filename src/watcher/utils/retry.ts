import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: (error: unknown) => {
    if (error instanceof Response) {
      return error.status === 409;
    }
    if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
      return true;
    }
    return false;
  },
};

export async function withExponentialRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!opts.shouldRetry(error)) {
        throw error;
      }

      if (attempt === opts.maxRetries) {
        break;
      }

      const delayMs = Math.min(opts.baseDelayMs * Math.pow(2, attempt), opts.maxDelayMs);

      logger.debug(
        `Retrying after 409 error (attempt ${attempt + 1}/${opts.maxRetries}, waiting ${delayMs}ms)`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
