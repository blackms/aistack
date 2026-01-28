import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  retryWithBackoff,
  retryWithCircuitBreaker,
} from '../../src/utils/retry.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('CircuitBreaker', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should create with custom options', () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('getState', () => {
    it('should return initial state as CLOSED', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('isOpen', () => {
    it('should return false when CLOSED', () => {
      const breaker = new CircuitBreaker('test');
      expect(breaker.isOpen()).toBe(false);
    });

    it('should return true when OPEN and timeout not elapsed', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1, timeout: 60000 });

      // Trigger failure to open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.isOpen()).toBe(true);
    });

    it('should transition to HALF_OPEN when timeout elapsed', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        timeout: 10, // Very short timeout
      });

      // Open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 20));

      // isOpen should transition to HALF_OPEN
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('HALF_OPEN');
    });
  });

  describe('execute', () => {
    it('should execute function when CLOSED', async () => {
      const breaker = new CircuitBreaker('test');
      const result = await breaker.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });

    it('should throw when circuit is OPEN', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1, timeout: 60000 });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      await expect(
        breaker.execute(() => Promise.resolve('success'))
      ).rejects.toThrow('Circuit breaker is OPEN for test');
    });

    it('should propagate errors from function', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 5 });

      await expect(
        breaker.execute(() => Promise.reject(new Error('custom error')))
      ).rejects.toThrow('custom error');
    });

    it('should track failures and open circuit at threshold', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 3, timeout: 60000 });

      // First 2 failures should keep circuit closed
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('CLOSED');

      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('CLOSED');

      // Third failure should open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should reset failure count on success', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 3, timeout: 60000 });

      // 2 failures
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Success resets count
      await breaker.execute(() => Promise.resolve('success'));

      // 2 more failures should not open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('HALF_OPEN state', () => {
    it('should transition to CLOSED after success threshold', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 10,
      });

      // Open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 20));
      breaker.isOpen(); // Triggers transition to HALF_OPEN
      expect(breaker.getState()).toBe('HALF_OPEN');

      // First success
      await breaker.execute(() => Promise.resolve('success'));
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Second success should close circuit
      await breaker.execute(() => Promise.resolve('success'));
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should transition to OPEN on failure in HALF_OPEN', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        timeout: 10,
      });

      // Open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 20));
      breaker.isOpen();
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Failure in HALF_OPEN should reopen
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('reset', () => {
    it('should reset circuit to CLOSED', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1, timeout: 60000 });

      // Open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');

      // Reset
      breaker.reset();
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should allow execution after reset', async () => {
      const breaker = new CircuitBreaker('test', { failureThreshold: 1, timeout: 60000 });

      // Open circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Reset and execute
      breaker.reset();
      const result = await breaker.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });
  });
});

describe('retryWithBackoff', () => {
  it('should return result on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, { initialDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Invalid input'));

    await expect(
      retryWithBackoff(fn, { maxAttempts: 3 })
    ).rejects.toThrow('Invalid input');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry with custom retryable errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('CUSTOM_ERROR'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, {
      initialDelayMs: 10,
      retryableErrors: ['CUSTOM_ERROR'],
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry with regex pattern', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Error code: E12345'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, {
      initialDelayMs: 10,
      retryableErrors: [/E\d+/],
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('rate_limit'));

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
      })
    ).rejects.toThrow('rate_limit');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should apply exponential backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, {
      initialDelayMs: 10,
      backoffMultiplier: 2,
      maxAttempts: 3,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect maxDelayMs', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, {
      initialDelayMs: 50,
      maxDelayMs: 60,
      backoffMultiplier: 10,
      maxAttempts: 3,
    });

    expect(result).toBe('success');
  });

  it('should handle non-Error thrown values', async () => {
    const fn = vi.fn().mockRejectedValue('string error');

    await expect(retryWithBackoff(fn)).rejects.toThrow('string error');
  });

  it('should use default options', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('success');
  });

  it('should retry on ECONNRESET error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, { initialDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 429 error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, { initialDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 503 error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, { initialDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('retryWithCircuitBreaker', () => {
  it('should combine circuit breaker with retry', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 5 });
    const fn = vi.fn().mockResolvedValue('success');

    const result = await retryWithCircuitBreaker(fn, breaker);
    expect(result).toBe('success');
  });

  it('should fail fast when circuit is open', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 1, timeout: 60000 });

    // Open circuit
    await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

    const fn = vi.fn().mockResolvedValue('success');

    await expect(
      retryWithCircuitBreaker(fn, breaker)
    ).rejects.toThrow('Circuit breaker is OPEN');

    expect(fn).not.toHaveBeenCalled();
  });

  it('should use custom retry options', async () => {
    const breaker = new CircuitBreaker('test', { failureThreshold: 10 });
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    const result = await retryWithCircuitBreaker(fn, breaker, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    expect(result).toBe('success');
  });
});
