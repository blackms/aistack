/**
 * Hooks module - event-driven extensibility
 */

import type { HookEvent, HookContext, AgentStackConfig } from '../types.js';
import { MemoryManager } from '../memory/index.js';
import { sessionStartHook, sessionEndHook } from './session.js';
import { preTaskHook, postTaskHook } from './task.js';
import { logger } from '../utils/logger.js';

const log = logger.child('hooks');

// Custom hook handlers
type HookHandler = (context: HookContext, memory: MemoryManager, config: AgentStackConfig) => Promise<void>;
const customHooks: Map<HookEvent, HookHandler[]> = new Map();

/**
 * Execute hooks for an event
 */
export async function executeHooks(
  event: HookEvent,
  context: HookContext,
  memory: MemoryManager,
  config: AgentStackConfig
): Promise<void> {
  // Check if hook is enabled
  const hookEnabled = isHookEnabled(event, config);
  if (!hookEnabled) {
    log.debug('Hook disabled', { event });
    return;
  }

  context.event = event;

  try {
    // Execute built-in hooks
    switch (event) {
      case 'session-start':
        await sessionStartHook(context, memory, config);
        break;
      case 'session-end':
        await sessionEndHook(context, memory, config);
        break;
      case 'pre-task':
        await preTaskHook(context, memory, config);
        break;
      case 'post-task':
        await postTaskHook(context, memory, config);
        break;
    }

    // Execute custom hooks
    const handlers = customHooks.get(event) ?? [];
    for (const handler of handlers) {
      try {
        await handler(context, memory, config);
      } catch (error) {
        log.error('Custom hook error', {
          event,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.debug('Hooks executed', { event, customCount: handlers.length });
  } catch (error) {
    log.error('Hook execution failed', {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Check if a hook is enabled in config
 */
function isHookEnabled(event: HookEvent, config: AgentStackConfig): boolean {
  switch (event) {
    case 'session-start':
      return config.hooks.sessionStart;
    case 'session-end':
      return config.hooks.sessionEnd;
    case 'pre-task':
      return config.hooks.preTask;
    case 'post-task':
      return config.hooks.postTask;
    default:
      return true;
  }
}

/**
 * Register a custom hook handler
 */
export function registerHook(event: HookEvent, handler: HookHandler): void {
  const handlers = customHooks.get(event) ?? [];
  handlers.push(handler);
  customHooks.set(event, handlers);
  log.debug('Registered custom hook', { event });
}

/**
 * Unregister all custom hooks for an event
 */
export function unregisterHooks(event: HookEvent): void {
  customHooks.delete(event);
}

/**
 * Clear all custom hooks
 */
export function clearCustomHooks(): void {
  customHooks.clear();
}

/**
 * Get registered hook count
 */
export function getHookCount(event?: HookEvent): number {
  if (event) {
    return customHooks.get(event)?.length ?? 0;
  }

  let total = 0;
  for (const handlers of customHooks.values()) {
    total += handlers.length;
  }
  return total;
}

// Re-export hook functions
export { sessionStartHook, sessionEndHook } from './session.js';
export { preTaskHook, postTaskHook } from './task.js';
