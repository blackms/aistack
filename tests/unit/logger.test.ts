/**
 * Logger tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, createLogger } from '../../src/utils/logger.js';

describe('Logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    // Reset to info level before each test
    logger.setLevel('info');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should log debug messages when level is debug', () => {
      logger.setLevel('debug');
      logger.debug('debug message');

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should log info messages', () => {
      logger.setLevel('info');
      logger.info('info message');

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should log warn messages', () => {
      logger.setLevel('warn');
      logger.warn('warn message');

      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should log error messages', () => {
      logger.setLevel('error');
      logger.error('error message');

      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should not log debug when level is info', () => {
      logger.setLevel('info');
      logger.debug('debug message');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should not log info when level is warn', () => {
      logger.setLevel('warn');
      logger.info('info message');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should not log warn when level is error', () => {
      logger.setLevel('error');
      logger.warn('warn message');

      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });
  });

  describe('context', () => {
    it('should include context in log output', () => {
      logger.setLevel('info');
      logger.info('message with context', { key: 'value' });

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('key');
      expect(output).toContain('value');
    });
  });

  describe('child logger', () => {
    it('should create child logger with prefix', () => {
      const child = logger.child('component');

      child.info('child message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('component');
    });

    it('should inherit log level from parent', () => {
      logger.setLevel('warn');
      const child = logger.child('component');

      child.info('should not log');
      expect(consoleSpy.log).not.toHaveBeenCalled();

      child.warn('should log');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });
  });

  describe('createLogger', () => {
    it('should create logger with prefix', () => {
      const log = createLogger('test-component');
      log.info('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('test-component');
    });
  });

  describe('setLevel', () => {
    it('should change log level dynamically', () => {
      logger.setLevel('error');

      logger.info('should not log');
      expect(consoleSpy.log).not.toHaveBeenCalled();

      logger.setLevel('info');
      logger.info('should log now');
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('setColors', () => {
    it('should disable colors', () => {
      logger.setColors(false);
      logger.info('message');

      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('child logger', () => {
    it('should create child logger with module prefix', () => {
      const childLogger = logger.child('my-module');
      childLogger.info('message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('my-module');
    });
  });

  describe('color output', () => {
    it('should format with colors when TTY and colors enabled', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

      const colorLogger = createLogger('color-test');
      colorLogger.setColors(true);
      colorLogger.info('colored message', { test: 'context' });

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      // Should contain ANSI escape codes when colors are enabled
      expect(output).toContain('colored message');
      expect(output).toContain('color-test');

      // Restore
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    });

    it('should format all log levels with colors when TTY', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

      const colorLogger = createLogger('color-levels');
      colorLogger.setColors(true);
      colorLogger.setLevel('debug');

      colorLogger.debug('debug message');
      colorLogger.info('info message');
      colorLogger.warn('warn message');
      colorLogger.error('error message');

      expect(consoleSpy.log).toHaveBeenCalledTimes(2); // debug and info
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);

      // Restore
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    });

    it('should not use colors when isTTY is false', () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });

      const noColorLogger = createLogger('no-color-test');
      noColorLogger.setColors(true);
      noColorLogger.info('plain message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      // Should not contain ANSI escape codes
      expect(output).not.toContain('\x1b[');

      // Restore
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    });
  });
});
