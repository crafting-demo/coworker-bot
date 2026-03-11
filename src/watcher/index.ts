export { Watcher } from './Watcher.js';

export { ConfigLoader } from './core/ConfigLoader.js';
export { CommandExecutor } from './utils/CommandExecutor.js';

export { BaseProvider } from './providers/BaseProvider.js';
export { ProviderRegistry } from './providers/ProviderRegistry.js';
export { GitHubProvider } from './providers/github/GitHubProvider.js';
export { GitLabProvider } from './providers/gitlab/GitLabProvider.js';
export { LinearProvider } from './providers/linear/LinearProvider.js';
export { SlackProvider } from './providers/slack/SlackProvider.js';

export type {
  WatcherConfig,
  ServerConfig,
  DeduplicationConfig,
  IProvider,
  ProviderConfig,
  ProviderAuth,
  ProviderMetadata,
  Reactor,
  EventHandler,
} from './types/index.js';

export { WatcherError, ProviderError, ConfigError } from './utils/errors.js';

export { logger } from './utils/logger.js';
