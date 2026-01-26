/**
 * Structured logger with JSON output and error tracking
 */

import * as Sentry from '@sentry/node';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  module?: string;
  error?: SerializedError;
  [key: string]: unknown;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  [key: string]: unknown;
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

// Sentry initialization flag
let sentryInitialized = false;

/**
 * Initialize Sentry error tracking
 */
export function initErrorTracking(dsn?: string, options?: Sentry.NodeOptions): void {
  const sentryDsn = dsn || process.env.SENTRY_DSN;

  if (!sentryDsn) {
    return; // Sentry is optional
  }

  if (sentryInitialized) {
    return;
  }

  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
    ...options,
  });

  sentryInitialized = true;
}

/**
 * Serialize an error object for logging
 */
function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error as any), // Include any additional properties
    };
  }

  if (typeof error === 'object' && error !== null) {
    return error as SerializedError;
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

class Logger {
  private level: LogLevel = 'info';
  private module: string = '';
  private format: LogFormat = 'pretty';
  private useColors: boolean = true;

  constructor() {
    // Auto-detect format based on environment
    if (process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production') {
      this.format = 'json';
      this.useColors = false;
    }

    // Set log level from environment
    const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
      this.level = envLevel;
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setModule(module: string): void {
    this.module = module;
  }

  setFormat(format: LogFormat): void {
    this.format = format;
    this.useColors = format !== 'json';
  }

  setColors(enabled: boolean): void {
    this.useColors = enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatPretty(entry: LogEntry): string {
    const timestamp = entry.timestamp;
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const module = entry.module ? `[${entry.module}] ` : '';

    // Build context string from all extra fields
    const extraFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!['level', 'message', 'timestamp', 'module', 'error'].includes(key)) {
        extraFields[key] = value;
      }
    }

    const contextStr = Object.keys(extraFields).length > 0
      ? ` ${DIM}${JSON.stringify(extraFields)}${RESET}`
      : '';

    const errorStr = entry.error
      ? `\n${entry.error.stack || `${entry.error.name}: ${entry.error.message}`}`
      : '';

    if (this.useColors && process.stdout.isTTY) {
      const color = COLORS[entry.level];
      return `${DIM}${timestamp}${RESET} ${color}${levelStr}${RESET} ${module}${entry.message}${contextStr}${errorStr}`;
    }

    return `${timestamp} ${levelStr} ${module}${entry.message}${contextStr}${errorStr}`;
  }

  private formatJSON(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(this.module && { module: this.module }),
      ...context,
    };

    // Extract error if present in context
    if (context?.error) {
      entry.error = serializeError(context.error);
      delete (entry as any).error; // Remove from context to avoid duplication
    }

    const formatted = this.format === 'json'
      ? this.formatJSON(entry)
      : this.formatPretty(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        // Send errors to Sentry
        if (sentryInitialized) {
          const error = context?.error instanceof Error
            ? context.error
            : new Error(message);
          Sentry.captureException(error, {
            level: 'error',
            contexts: {
              logger: {
                module: this.module,
                ...context,
              },
            },
          });
        }
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

  /**
   * Create a child logger with a module prefix
   */
  child(module: string): Logger {
    const child = new Logger();
    child.level = this.level;
    child.module = this.module ? `${this.module}:${module}` : module;
    child.format = this.format;
    child.useColors = this.useColors;
    return child;
  }

  /**
   * Flush any pending logs (for graceful shutdown)
   */
  async flush(): Promise<void> {
    if (sentryInitialized) {
      await Sentry.close(2000);
    }
  }
}

// Singleton logger instance
export const logger = new Logger();

// Factory for child loggers
export function createLogger(module: string): Logger {
  return logger.child(module);
}

// Export Sentry for advanced usage
export { Sentry };
