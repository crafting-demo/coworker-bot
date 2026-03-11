import type { IProvider, ProviderConfig, ProviderMetadata, EventHandler } from '../types/index.js';
import { ProviderError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export abstract class BaseProvider implements IProvider {
  protected config!: ProviderConfig;

  abstract get metadata(): ProviderMetadata;

  async initialize(config: ProviderConfig): Promise<void> {
    logger.debug(`Initializing provider: ${this.metadata.name}`);
    this.config = config;
  }

  async validateWebhook(
    _headers: Record<string, string | string[] | undefined>,
    _body: unknown,
    _rawBody?: string | Buffer
  ): Promise<boolean> {
    return true;
  }

  async handleWebhook(
    _headers: Record<string, string | string[] | undefined>,
    _body: unknown,
    _eventHandler: EventHandler
  ): Promise<void> {
    throw new ProviderError('handleWebhook not implemented', this.metadata.name);
  }

  async poll(_eventHandler: EventHandler): Promise<void> {
    // Default: do nothing (no polling)
  }

  async shutdown(): Promise<void> {
    logger.debug(`Shutting down provider: ${this.metadata.name}`);
  }
}
