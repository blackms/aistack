/**
 * Plugin registry - track installed plugins
 */

import type { AgentStackPlugin } from '../types.js';

interface PluginEntry {
  name: string;
  version: string;
  enabled: boolean;
  installedAt: Date;
  config?: Record<string, unknown>;
}

// In-memory registry (could be persisted to SQLite)
const registry: Map<string, PluginEntry> = new Map();

/**
 * Register a plugin in the registry
 */
export function registerPluginEntry(plugin: AgentStackPlugin): void {
  registry.set(plugin.name, {
    name: plugin.name,
    version: plugin.version,
    enabled: true,
    installedAt: new Date(),
  });
}

/**
 * Get a plugin entry from the registry
 */
export function getPluginEntry(name: string): PluginEntry | null {
  return registry.get(name) ?? null;
}

/**
 * List all registered plugins
 */
export function listPluginEntries(): PluginEntry[] {
  return Array.from(registry.values());
}

/**
 * Update plugin enabled status
 */
export function setPluginEnabled(name: string, enabled: boolean): boolean {
  const entry = registry.get(name);
  if (!entry) return false;
  entry.enabled = enabled;
  return true;
}

/**
 * Update plugin config
 */
export function setPluginConfig(name: string, config: Record<string, unknown>): boolean {
  const entry = registry.get(name);
  if (!entry) return false;
  entry.config = config;
  return true;
}

/**
 * Remove a plugin from the registry
 */
export function removePluginEntry(name: string): boolean {
  return registry.delete(name);
}

/**
 * Check if a plugin is registered
 */
export function isPluginRegistered(name: string): boolean {
  return registry.has(name);
}

/**
 * Get the count of registered plugins
 */
export function getRegisteredPluginCount(): { total: number; enabled: number } {
  let enabled = 0;
  for (const entry of registry.values()) {
    if (entry.enabled) enabled++;
  }
  return { total: registry.size, enabled };
}
