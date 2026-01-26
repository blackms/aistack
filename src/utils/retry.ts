/**
 * Retry logic with exponential backoff and circuit breaker
 */

import { logger } from './logger.js';

const log = logger.child('retry');

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: Array<string | RegExp>;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  halfOpenRetryDelayMs?: number;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit Breaker implementation
 * Prevents cascading failures by stopping requests when error rate is too high
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly halfOpenRetryDelayMs: number;
  private readonly name: string;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60000; // 1 minute
    this.halfOpenRetryDelayMs = options.halfOpenRetryDelayMs ?? 30000; // 30 seconds
  }

  getState(): CircuitState {
    return this.state;
  }

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      // Check if we should transition to HALF_OPEN
      if (Date.now() >= this.nextAttemptTime) {
        log.info('Circuit breaker transitioning to HALF_OPEN', { name: this.name });
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error(`Circuit breaker is OPEN for ${this.name}`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        log.info('Circuit breaker transitioning to CLOSED', { name: this.name });
        this.state = 'CLOSED';
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;

    if (this.state === 'HALF_OPEN') {
      log.warn('Circuit breaker transitioning to OPEN (failure in HALF_OPEN)', {
        name: this.name,
      });
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.timeout;
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      log.warn('Circuit breaker transitioning to OPEN', {
        name: this.name,
        failureCount: this.failureCount,
        threshold: this.failureThreshold,
      });
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.timeout;
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
    log.info('Circuit breaker reset', { name: this.name });
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const retryableErrors = options.retryableErrors ?? [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'rate_limit',
    'timeout',
    '429',
    '500',
    '502',
    '503',
    '504',
  ];

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      const isRetryable = retryableErrors.some((pattern) => {
        if (typeof pattern === 'string') {
          return lastError!.message.includes(pattern);
        }
        return pattern.test(lastError!.message);
      });

      if (!isRetryable || attempt === maxAttempts) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        initialDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs
      );
      const jitter = Math.random() * 0.3 * baseDelay; // Up to 30% jitter
      const delay = baseDelay + jitter;

      log.warn('Retrying after error', {
        attempt,
        maxAttempts,
        delayMs: Math.round(delay),
        error: lastError.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with circuit breaker
 */
export async function retryWithCircuitBreaker<T>(
  fn: () => Promise<T>,
  circuitBreaker: CircuitBreaker,
  retryOptions?: RetryOptions
): Promise<T> {
  return circuitBreaker.execute(() => retryWithBackoff(fn, retryOptions));
}
