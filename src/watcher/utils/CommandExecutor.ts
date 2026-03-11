import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import Handlebars from 'handlebars';
import type { Reactor, NormalizedEvent, CommandExecutorConfig } from '../types/index.js';
import { logger } from './logger.js';
import { formatLink, formatResourceLink } from './linkFormatter.js';

export class CommandExecutor {
  private promptTemplate: HandlebarsTemplateDelegate | undefined;
  private providerTemplates: Map<string, HandlebarsTemplateDelegate> = new Map();

  constructor(private readonly config: CommandExecutorConfig) {
    if (!config.enabled) {
      return;
    }

    // Register Handlebars helpers
    this.registerHelpers();

    // Load provider-specific prompt templates if provided
    if (config.prompts) {
      for (const [provider, templatePath] of Object.entries(config.prompts)) {
        try {
          const content = readFileSync(templatePath, 'utf-8');
          this.providerTemplates.set(provider, Handlebars.compile(content));
          logger.debug(`Loaded prompt template for provider: ${provider}`);
        } catch (error) {
          logger.error(`Failed to load template file for ${provider}: ${templatePath}`, error);
          throw error;
        }
      }
    }

    // Load default prompt template if provided (fallback)
    if (config.promptTemplateFile) {
      try {
        const content = readFileSync(config.promptTemplateFile, 'utf-8');
        this.promptTemplate = Handlebars.compile(content);
        logger.debug('Loaded default prompt template');
      } catch (error) {
        logger.error(`Failed to load template file: ${config.promptTemplateFile}`, error);
        throw error;
      }
    } else if (config.promptTemplate) {
      this.promptTemplate = Handlebars.compile(config.promptTemplate);
    }
  }

  private registerHelpers(): void {
    // Register 'eq' helper for equality comparisons
    Handlebars.registerHelper(
      'eq',
      function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
        if (a === b) {
          return options.fn(this);
        } else {
          return options.inverse(this);
        }
      }
    );

    // Register 'ne' helper for inequality comparisons
    Handlebars.registerHelper(
      'ne',
      function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
        if (a !== b) {
          return options.fn(this);
        } else {
          return options.inverse(this);
        }
      }
    );

    // Register 'and' helper for logical AND
    Handlebars.registerHelper(
      'and',
      function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
        if (a && b) {
          return options.fn(this);
        } else {
          return options.inverse(this);
        }
      }
    );

    // Register 'or' helper for logical OR
    Handlebars.registerHelper(
      'or',
      function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
        if (a || b) {
          return options.fn(this);
        } else {
          return options.inverse(this);
        }
      }
    );

    // Register 'link' helper for formatting links
    Handlebars.registerHelper('link', function (text: string, url: string, provider: string) {
      return new Handlebars.SafeString(formatLink(text, url, provider));
    });

    // Register 'resourceLink' helper for formatting resource links
    Handlebars.registerHelper('resourceLink', function (this: any) {
      const event = this as NormalizedEvent;
      return new Handlebars.SafeString(formatResourceLink(event));
    });

    // Register 'commentLink' helper for formatting comment links
    Handlebars.registerHelper('commentLink', function (this: any) {
      const event = this as NormalizedEvent;
      if (event.resource.comment?.url) {
        return new Handlebars.SafeString(
          formatLink('View Comment', event.resource.comment.url, event.provider)
        );
      }
      return '';
    });
  }

  /**
   * Sanitize a string for safe use in shell commands, filenames, etc.
   * Replaces all special characters with underscores.
   */
  private sanitizeForShell(str: string): string {
    // Replace all non-alphanumeric characters (except dash and underscore) with underscore
    // This ensures the string is safe for use in shell commands, environment variables, filenames
    return str.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Generate a short, clean ID from the normalized event.
   * Format: provider-repository-number-hash (e.g., "github-owner-repo-123-a1b2c3")
   * Works across providers (GitHub, GitLab, Jira, Linear, etc.)
   *
   * Hash suffix ensures uniqueness across all related events:
   * - Issue #123 opened: github-owner-repo-123-abc123
   * - PR #123 opened: github-owner-repo-123-def456
   * - Comment 1 on PR #123: github-owner-repo-123-ghi789
   * - Comment 2 on PR #123: github-owner-repo-123-jkl012
   */
  private generateShortId(event: NormalizedEvent): string {
    const provider = event.provider;
    const repo = event.resource.repository.replace(/\//g, '-');
    const number = event.resource.number;

    // Extract a short hash from the event ID to ensure uniqueness
    // Event IDs like "github:owner/repo:opened:123:uuid" contain unique identifiers
    // We'll take the last 6 characters of the ID as a short hash
    const shortHash = this.extractShortHash(event.id);

    return `${provider}-${repo}-${number}-${shortHash}`;
  }

  /**
   * Extract a short hash from the event ID for uniqueness.
   * Takes the last 6 alphanumeric characters from the event ID.
   */
  private extractShortHash(eventId: string): string {
    // Remove all non-alphanumeric characters and take last 6 chars
    const cleaned = eventId.replace(/[^a-zA-Z0-9]/g, '');
    return cleaned.slice(-6).toLowerCase();
  }

  async execute(
    eventId: string,
    displayString: string,
    event: NormalizedEvent,
    reactor: Reactor
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Render prompt template if available
      // Event is already normalized by the provider
      let prompt = '';

      // Select template based on provider (provider-specific or fallback to default)
      const template = this.providerTemplates.get(event.provider) || this.promptTemplate;

      if (template) {
        prompt = template(event);
        logger.debug(
          `Rendered prompt using ${this.providerTemplates.has(event.provider) ? 'provider-specific' : 'default'} template for ${event.provider}`
        );
      }

      // Post initial comment with user-friendly display string (always, even in dry-run)
      logger.info(`Executing command for event ${eventId}`);
      const _commentRef = await reactor.postComment(`Agent is working on ${displayString}`);

      // Dry-run mode: print command details without executing
      if (this.config.dryRun) {
        logger.info(`[DRY-RUN] Would execute command for event ${eventId}`);
        this.logDryRun(event, prompt);
        logger.info(`[DRY-RUN] Command execution skipped, but deduplication comment posted`);
        return;
      }

      // Run command
      const output = await this.runCommand(eventId, prompt, event);

      // Follow-up with output if enabled
      if (this.config.followUp && output) {
        const followUpComment = this.config.followUpTemplate
          ? this.config.followUpTemplate.replace('{output}', output.trim())
          : output;
        await reactor.postComment(followUpComment);
        logger.debug(`Posted follow-up comment with command output`);
      }
    } catch (error) {
      logger.error('Command execution failed', error);
    }
  }

  private logDryRun(event: NormalizedEvent, prompt: string): void {
    // Build environment variables that would be used
    const env: Record<string, string> = {
      EVENT_ID: event.id,
      EVENT_SAFE_ID: this.sanitizeForShell(event.id),
      EVENT_SHORT_ID: this.generateShortId(event),
    };

    if (!this.config.useStdin) {
      env.PROMPT = prompt;
    }

    logger.info('[DRY-RUN] Command:', this.config.command);
    logger.info('[DRY-RUN] Environment variables:');
    for (const [key, value] of Object.entries(env)) {
      if (key === 'PROMPT') {
        logger.info(`  ${key}=${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
      } else {
        logger.info(`  ${key}=${value}`);
      }
    }

    if (this.config.useStdin && prompt) {
      logger.info('[DRY-RUN] Stdin input:');
      logger.info(prompt.substring(0, 500) + (prompt.length > 500 ? '\n...(truncated)' : ''));
    }
  }

  private async runCommand(
    eventId: string,
    prompt: string,
    event: NormalizedEvent
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Minimal environment variables - just IDs and prompt
      // All event details should be in the prompt (rendered from template)
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        // Full event ID for internal tracking/logging
        EVENT_ID: event.id,
        // Sanitized ID safe for shell commands (colons/slashes → underscores)
        EVENT_SAFE_ID: this.sanitizeForShell(event.id),
        // Short, clean ID for command/session names (e.g., "github-owner-repo-123")
        EVENT_SHORT_ID: this.generateShortId(event),
      };

      // Add prompt if not using stdin
      if (!this.config.useStdin) {
        env.PROMPT = prompt;
      }

      const child = spawn('/bin/bash', ['-c', this.config.command], {
        env,
        stdio: this.config.useStdin ? 'pipe' : ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      if (this.config.useStdin && child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      child.on('error', (error) => {
        logger.error(`Command execution error for event ${eventId}`, error);
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          logger.info(`Command completed successfully for event ${eventId}`);
          if (stdout) {
            logger.debug(`Command output length: ${stdout.length} chars`);
          }
          resolve(stdout);
        } else {
          logger.error(`Command failed for event ${eventId} with code ${code}`, { stderr });
          reject(new Error(`Command exited with code ${code}: ${stderr}`));
        }
      });
    });
  }
}
