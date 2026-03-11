import type { ProviderConfig } from './provider.js';

export interface ServerConfig {
  host: string;
  port: number;
  basePath?: string;
}

/**
 * Deduplication configuration.
 *
 * NOTE: Bot usernames are configured per-provider, not at the top level.
 * Each provider should set options.botUsername to enable deduplication.
 * Example:
 *   providers:
 *     github:
 *       options:
 *         botUsername: "my-bot-username"
 */
export interface DeduplicationConfig {
  enabled: boolean;
  /** Template for "working on" comment. Supports {id} placeholder for event ID. */
  commentTemplate?: string;
}

export interface CommandExecutorConfig {
  enabled: boolean;
  command: string;
  promptTemplate?: string;
  promptTemplateFile?: string;
  /** Provider-specific prompt templates. Maps provider name to template file path. */
  prompts?: Record<string, string>;
  useStdin?: boolean;
  followUp?: boolean;
  /**
   * Template for the follow-up comment posted after the command completes.
   * Supports {output} placeholder for the command's stdout.
   * Example: "Session started: {output}"
   * If not set, the raw command output is posted as-is.
   * Only used when followUp is true.
   */
  followUpTemplate?: string;
  dryRun?: boolean;
}

export interface WatcherConfig {
  server?: ServerConfig;
  deduplication?: DeduplicationConfig;
  commandExecutor?: CommandExecutorConfig;
  providers: Record<string, ProviderConfig>;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
