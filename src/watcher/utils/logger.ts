export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
};

class Logger {
  private level: LogLevel = 'info';
  private colorsEnabled: boolean = true;

  constructor() {
    // Disable colors if not in TTY or if NO_COLOR env is set
    if (process.env.NO_COLOR || !process.stdout.isTTY) {
      this.colorsEnabled = false;
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setColors(enabled: boolean): void {
    this.colorsEnabled = enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private colorize(text: string, color: string): string {
    if (!this.colorsEnabled) {
      return text;
    }
    return `${color}${text}${COLORS.reset}`;
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const levelColor = LEVEL_COLORS[level];

    const coloredLevel = this.colorize(levelStr, levelColor + COLORS.bold);
    const coloredTimestamp = this.colorize(`[${timestamp}]`, COLORS.gray);

    let output = `${coloredTimestamp} ${coloredLevel} ${message}`;

    if (meta !== undefined) {
      output += '\n' + this.colorize(JSON.stringify(meta, null, 2), COLORS.gray);
    }

    return output;
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  private formatErrorChain(error: Error): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      message: error.message,
      name: error.name,
    };

    if (error.stack) {
      formatted.stack = error.stack;
    }

    // Recursively format the cause chain
    if (error.cause) {
      if (error.cause instanceof Error) {
        formatted.cause = this.formatErrorChain(error.cause);
      } else {
        formatted.cause = error.cause;
      }
    }

    return formatted;
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      let meta: unknown = error;
      if (error instanceof Error) {
        meta = this.formatErrorChain(error);
      }
      console.error(this.formatMessage('error', message, meta));
    }
  }
}

export const logger = new Logger();
