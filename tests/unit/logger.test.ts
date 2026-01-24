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

  describe('setPrefix', () => {
    it('should set logger prefix', () => {
      logger.setPrefix('my-prefix');
      logger.info('message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('my-prefix');

      // Reset prefix
      logger.setPrefix('');
    });
  });
});
