import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import type { WatcherConfig } from '../types/index.js';
import type { ProviderConfig } from '../types/provider.js';
import { ConfigError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class ConfigLoader {
  // Default command for Crafting Sandbox environments.
  // EVENT_SHORT_ID is a unique per-event identifier (e.g. "github-owner-repo-123-abc456").
  private static readonly DEFAULT_COMMAND =
    'cs llm session run --approval=auto --name=$EVENT_SHORT_ID --task';

  private static readonly DEFAULT_PROMPT_TEMPLATE = './config/event-prompt.hbs';

  /**
   * Primary entry point. Loads config from file (optional) then overlays env vars.
   * Env vars always win over file config.
   * The config file is optional — if absent, env vars alone are sufficient.
   *
   * Supported env vars:
   *
   * GitHub:
   *   GITHUB_PERSONAL_ACCESS_TOKEN  — enables GitHub provider
   *   GITHUB_BOT_USERNAME           — overrides bot username (auto-detected from token if absent)
   *   GITHUB_REPOSITORIES           — comma-separated list: owner/repo1,owner/repo2
   *   GITHUB_WEBHOOK_SECRET         — webhook signature verification secret
   *   GITHUB_POLLING_INTERVAL       — polling interval in seconds (default: 60)
   *
   * GitLab:
   *   GITLAB_TOKEN                  — enables GitLab provider
   *   GITLAB_BOT_USERNAME           — overrides bot username (auto-detected from token if absent)
   *   GITLAB_WEBHOOK_TOKEN          — webhook token for request verification
   *   GITLAB_POLLING_INTERVAL       — polling interval in seconds (default: 60)
   *
   * Linear:
   *   LINEAR_API_TOKEN              — enables Linear provider
   *   LINEAR_BOT_USERNAME           — overrides bot username (auto-detected from token if absent)
   *   LINEAR_TEAMS                  — comma-separated list of team keys (e.g. ENG,DESIGN)
   *   LINEAR_WEBHOOK_SECRET         — webhook signature verification secret
   *   LINEAR_POLLING_INTERVAL       — polling interval in seconds (default: 60)
   *
   * Slack:
   *   SLACK_BOT_TOKEN               — enables Slack provider
   *   SLACK_BOT_USERNAME            — overrides bot user ID (auto-detected from token if absent)
   *   SLACK_SIGNING_SECRET          — webhook request signing secret
   *
   * General:
   *   WATCHER_COMMAND               — command to run per event
   *   WATCHER_LOG_LEVEL             — debug | info | warn | error (default: info)
   */
  static loadWithEnv(configPath: string): WatcherConfig {
    let fileConfig: WatcherConfig | null = null;

    if (existsSync(configPath)) {
      logger.info(`Loading configuration from ${configPath}`);
      fileConfig = this.loadFile(configPath);
    } else {
      logger.info(`No config file at ${configPath}, using environment variables`);
    }

    const envConfig = this.buildFromEnv();
    const merged = this.merge(fileConfig ?? this.defaultConfig(), envConfig);
    this.validate(merged);
    return merged;
  }

  /**
   * Load config from file only (kept for backward compatibility).
   */
  static load(configPath: string): WatcherConfig {
    try {
      logger.info(`Loading configuration from ${configPath}`);
      const fileContent = readFileSync(configPath, 'utf-8');
      const interpolatedContent = this.interpolateEnvVars(fileContent);
      const config = load(interpolatedContent) as WatcherConfig;
      this.validate(config);
      return config;
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }
      throw new ConfigError(`Failed to load configuration: ${configPath}`, error);
    }
  }

  /**
   * Build a partial WatcherConfig from environment variables.
   * Only sets fields for which the corresponding env var is present.
   */
  static buildFromEnv(): Partial<WatcherConfig> {
    const result: Partial<WatcherConfig> = { providers: {} };

    // GitHub — auto-enabled when GITHUB_PERSONAL_ACCESS_TOKEN is set
    if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      const options: Record<string, unknown> = {};

      if (process.env.GITHUB_BOT_USERNAME) {
        options.botUsername = process.env.GITHUB_BOT_USERNAME;
      }
      if (process.env.GITHUB_REPOSITORIES) {
        options.repositories = process.env.GITHUB_REPOSITORIES.split(',')
          .map((r) => r.trim())
          .filter(Boolean);
      }
      if (process.env.GITHUB_WEBHOOK_SECRET) {
        options.webhookSecretEnv = 'GITHUB_WEBHOOK_SECRET';
      }

      const githubConfig: ProviderConfig = {
        enabled: true,
        auth: { type: 'token', tokenEnv: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
        options,
      };
      if (process.env.GITHUB_POLLING_INTERVAL) {
        githubConfig.pollingInterval = parseInt(process.env.GITHUB_POLLING_INTERVAL, 10);
      }
      result.providers!.github = githubConfig;
    }

    // Linear — auto-enabled when LINEAR_API_TOKEN is set
    if (process.env.LINEAR_API_TOKEN) {
      const options: Record<string, unknown> = {};

      if (process.env.LINEAR_BOT_USERNAME) {
        options.botUsername = process.env.LINEAR_BOT_USERNAME;
      }
      if (process.env.LINEAR_TEAMS) {
        options.teams = process.env.LINEAR_TEAMS.split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
      if (process.env.LINEAR_WEBHOOK_SECRET) {
        options.webhookSecretEnv = 'LINEAR_WEBHOOK_SECRET';
      }

      const linearConfig: ProviderConfig = {
        enabled: true,
        auth: { type: 'token', tokenEnv: 'LINEAR_API_TOKEN' },
        options,
      };
      if (process.env.LINEAR_POLLING_INTERVAL) {
        linearConfig.pollingInterval = parseInt(process.env.LINEAR_POLLING_INTERVAL, 10);
      }
      result.providers!.linear = linearConfig;
    }

    // GitLab — auto-enabled when GITLAB_TOKEN is set
    if (process.env.GITLAB_TOKEN) {
      const options: Record<string, unknown> = {};

      if (process.env.GITLAB_BOT_USERNAME) {
        options.botUsername = process.env.GITLAB_BOT_USERNAME;
      }
      if (process.env.GITLAB_WEBHOOK_TOKEN) {
        options.webhookTokenEnv = 'GITLAB_WEBHOOK_TOKEN';
      }

      const gitlabConfig: ProviderConfig = {
        enabled: true,
        auth: { type: 'token', tokenEnv: 'GITLAB_TOKEN' },
        options,
      };
      if (process.env.GITLAB_POLLING_INTERVAL) {
        gitlabConfig.pollingInterval = parseInt(process.env.GITLAB_POLLING_INTERVAL, 10);
      }
      result.providers!.gitlab = gitlabConfig;
    }

    // Slack — auto-enabled when SLACK_BOT_TOKEN is set
    if (process.env.SLACK_BOT_TOKEN) {
      const options: Record<string, unknown> = {};

      if (process.env.SLACK_BOT_USERNAME) {
        options.botUsername = process.env.SLACK_BOT_USERNAME;
      }
      if (process.env.SLACK_SIGNING_SECRET) {
        options.signingSecretEnv = 'SLACK_SIGNING_SECRET';
      }

      result.providers!.slack = {
        enabled: true,
        auth: { type: 'token', tokenEnv: 'SLACK_BOT_TOKEN' },
        options,
      };
    }

    // Command override
    if (process.env.WATCHER_COMMAND) {
      result.commandExecutor = {
        enabled: true,
        command: process.env.WATCHER_COMMAND,
      };
    }

    // Log level
    if (process.env.WATCHER_LOG_LEVEL) {
      const level = process.env.WATCHER_LOG_LEVEL;
      if (['debug', 'info', 'warn', 'error'].includes(level)) {
        result.logLevel = level as 'debug' | 'info' | 'warn' | 'error';
      }
    }

    return result;
  }

  /**
   * Merge two configs. Fields in `override` win over `base`.
   * Fields absent from `override` are taken from `base` unchanged.
   */
  private static merge(base: WatcherConfig, override: Partial<WatcherConfig>): WatcherConfig {
    const result: WatcherConfig = structuredClone(base);

    const logLevel = override.logLevel;
    if (logLevel) {
      result.logLevel = logLevel;
    }

    if (override.commandExecutor) {
      if (!result.commandExecutor) {
        result.commandExecutor = override.commandExecutor;
      } else {
        const ov = override.commandExecutor;
        if (ov.enabled !== undefined) result.commandExecutor.enabled = ov.enabled;
        if (ov.command) result.commandExecutor.command = ov.command;
      }
    }

    for (const [name, envProvider] of Object.entries(override.providers ?? {})) {
      if (!result.providers[name]) {
        result.providers[name] = envProvider;
      } else {
        const base = result.providers[name];
        if (envProvider.enabled !== undefined) base.enabled = envProvider.enabled;
        if (envProvider.pollingInterval !== undefined)
          base.pollingInterval = envProvider.pollingInterval;
        if (envProvider.auth) {
          base.auth = { ...base.auth, ...envProvider.auth };
        }
        if (envProvider.options && Object.keys(envProvider.options).length > 0) {
          base.options = { ...base.options, ...envProvider.options };
        }
      }
    }

    return result;
  }

  /**
   * Sensible defaults used as the base when no watcher.yaml is present.
   */
  private static defaultConfig(): WatcherConfig {
    return {
      server: { host: '0.0.0.0', port: 3000 },
      deduplication: {
        enabled: true,
        commentTemplate: 'Agent is working on {id}',
      },
      commandExecutor: {
        enabled: true,
        command: this.DEFAULT_COMMAND,
        promptTemplateFile: this.DEFAULT_PROMPT_TEMPLATE,
        useStdin: true,
        followUp: true,
      },
      providers: {},
    };
  }

  private static loadFile(configPath: string): WatcherConfig {
    try {
      const fileContent = readFileSync(configPath, 'utf-8');
      const interpolatedContent = this.interpolateEnvVars(fileContent);
      return load(interpolatedContent) as WatcherConfig;
    } catch (error) {
      throw new ConfigError(`Failed to load configuration: ${configPath}`, error);
    }
  }

  private static interpolateEnvVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        logger.warn(`Environment variable ${varName} not found, keeping placeholder`);
        return match;
      }
      return value;
    });
  }

  private static validate(config: WatcherConfig): void {
    if (!config.providers || typeof config.providers !== 'object') {
      throw new ConfigError(
        'No providers configured. Set GITHUB_PERSONAL_ACCESS_TOKEN (or LINEAR_API_TOKEN / ' +
          'SLACK_BOT_TOKEN) to configure a provider, or create config/watcher.yaml.'
      );
    }

    const enabledProviders = Object.entries(config.providers).filter(([, c]) => c.enabled);
    if (enabledProviders.length === 0) {
      throw new ConfigError(
        'No providers enabled. Set GITHUB_PERSONAL_ACCESS_TOKEN to enable GitHub, ' +
          'LINEAR_API_TOKEN for Linear, or SLACK_BOT_TOKEN for Slack. ' +
          'Alternatively, configure providers in config/watcher.yaml.'
      );
    }

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      if (!providerConfig.enabled) {
        continue;
      }

      if (!providerConfig.auth) {
        logger.warn(
          `Provider ${name}: No auth configured. Polling mode and comment-based deduplication will not be available.`
        );
      }
    }
  }

  static resolveSecret(value?: string, envVar?: string, file?: string): string | undefined {
    if (value) {
      return value;
    }

    if (envVar) {
      const envValue = process.env[envVar];
      if (!envValue) {
        throw new ConfigError(`Environment variable ${envVar} not found`);
      }
      return envValue;
    }

    if (file) {
      try {
        return readFileSync(file, 'utf-8').trim();
      } catch (error) {
        throw new ConfigError(`Failed to read secret from file: ${file}`, error);
      }
    }

    return undefined;
  }
}
