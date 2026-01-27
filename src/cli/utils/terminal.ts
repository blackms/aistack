/**
 * Terminal formatting utilities for CLI output
 */

import type { AgentStatus } from '../../types.js';

// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
} as const;

/**
 * Format duration from milliseconds to human-readable string
 * @param ms Duration in milliseconds
 * @returns Formatted string like "2m 34s"
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get status indicator icon
 */
export function statusIcon(status: AgentStatus): string {
  switch (status) {
    case 'running':
      return '\u25cf'; // ● filled circle
    case 'idle':
      return '\u25cb'; // ○ empty circle
    case 'completed':
      return '\u2713'; // ✓ check mark
    case 'failed':
      return '\u2717'; // ✗ x mark
    case 'stopped':
      return '\u25a0'; // ■ filled square
    default:
      return '?';
  }
}

/**
 * Get ANSI color for status
 */
export function statusColor(status: AgentStatus): string {
  switch (status) {
    case 'running':
      return colors.green;
    case 'idle':
      return colors.yellow;
    case 'completed':
      return colors.green;
    case 'failed':
      return colors.red;
    case 'stopped':
      return colors.gray;
    default:
      return colors.white;
  }
}

/**
 * Get short status label
 */
export function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'running':
      return 'RUN';
    case 'idle':
      return 'IDLE';
    case 'completed':
      return 'DONE';
    case 'failed':
      return 'FAIL';
    case 'stopped':
      return 'STOP';
  }
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen - 1) + '\u2026'; // ellipsis character
}

/**
 * Pad string to exact width (truncates if necessary)
 */
export function padToWidth(text: string, width: number): string {
  const truncated = truncate(text, width);
  return truncated.padEnd(width);
}

/**
 * Clear the terminal screen
 */
export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

/**
 * Hide cursor
 */
export function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

/**
 * Show cursor
 */
export function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}

/**
 * Format current time as HH:MM:SS
 */
export function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
