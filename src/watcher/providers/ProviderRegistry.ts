import type { IProvider } from '../types/index.js';
import { ProviderError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class ProviderRegistry {
  private providers: Map<string, IProvider> = new Map();

  register(name: string, provider: IProvider): void {
    if (this.providers.has(name)) {
      throw new ProviderError(`Provider ${name} is already registered`, name);
    }

    logger.info(`Registering provider: ${name}`);
    this.providers.set(name, provider);
  }

  unregister(name: string): void {
    if (!this.providers.has(name)) {
      throw new ProviderError(`Provider ${name} is not registered`, name);
    }

    logger.info(`Unregistering provider: ${name}`);
    this.providers.delete(name);
  }

  get(name: string): IProvider | undefined {
    return this.providers.get(name);
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  getAll(): Map<string, IProvider> {
    return new Map(this.providers);
  }
}
