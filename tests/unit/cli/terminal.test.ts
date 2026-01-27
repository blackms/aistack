/**
 * Tests for terminal utilities
 */

import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  statusIcon,
  statusColor,
  statusLabel,
  truncate,
  padToWidth,
  formatTime,
  colors,
} from '../../../src/cli/utils/terminal.js';

describe('Terminal Utilities', () => {
  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(45000)).toBe('45s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(65000)).toBe('1m 5s');
      expect(formatDuration(150000)).toBe('2m 30s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3665000)).toBe('1h 1m');
      expect(formatDuration(7200000)).toBe('2h 0m');
    });

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });
  });

  describe('statusIcon', () => {
    it('should return correct icons for each status', () => {
      expect(statusIcon('running')).toBe('\u25cf');
      expect(statusIcon('idle')).toBe('\u25cb');
      expect(statusIcon('completed')).toBe('\u2713');
      expect(statusIcon('failed')).toBe('\u2717');
      expect(statusIcon('stopped')).toBe('\u25a0');
    });
  });

  describe('statusColor', () => {
    it('should return correct colors for each status', () => {
      expect(statusColor('running')).toBe(colors.green);
      expect(statusColor('idle')).toBe(colors.yellow);
      expect(statusColor('completed')).toBe(colors.green);
      expect(statusColor('failed')).toBe(colors.red);
      expect(statusColor('stopped')).toBe(colors.gray);
    });
  });

  describe('statusLabel', () => {
    it('should return correct labels for each status', () => {
      expect(statusLabel('running')).toBe('RUN');
      expect(statusLabel('idle')).toBe('IDLE');
      expect(statusLabel('completed')).toBe('DONE');
      expect(statusLabel('failed')).toBe('FAIL');
      expect(statusLabel('stopped')).toBe('STOP');
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('should truncate long strings with ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello w\u2026');
    });

    it('should handle exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });

  describe('padToWidth', () => {
    it('should pad short strings', () => {
      expect(padToWidth('hi', 5)).toBe('hi   ');
    });

    it('should truncate and pad long strings', () => {
      expect(padToWidth('hello world', 8)).toBe('hello w\u2026');
    });
  });

  describe('formatTime', () => {
    it('should format time as HH:MM:SS', () => {
      const date = new Date('2024-01-15T14:32:45');
      const result = formatTime(date);
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });
});
