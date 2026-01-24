/**
 * Simple, clean logger for agentstack
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

class Logger {
  private level: LogLevel = 'info';
  private prefix: string = '';
  private useColors: boolean = true;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  setColors(enabled: boolean): void {
    this.useColors = enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const prefix = this.prefix ? `[${this.prefix}] ` : '';

    if (this.useColors && process.stdout.isTTY) {
      const color = COLORS[entry.level];
      const contextStr = entry.context
        ? ` ${DIM}${JSON.stringify(entry.context)}${RESET}`
        : '';
      return `${DIM}${timestamp}${RESET} ${color}${levelStr}${RESET} ${prefix}${entry.message}${contextStr}`;
    }

    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    return `${timestamp} ${levelStr} ${prefix}${entry.message}${contextStr}`;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
    };

    const formatted = this.formatMessage(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  child(prefix: string): Logger {
    const child = new Logger();
    child.level = this.level;
    child.prefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    child.useColors = this.useColors;
    return child;
  }
}

// Singleton logger instance
export const logger = new Logger();

// Factory for child loggers
export function createLogger(prefix: string): Logger {
  return logger.child(prefix);
}
