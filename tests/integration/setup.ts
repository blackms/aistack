/**
 * Integration test setup
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultConfig } from '../../src/utils/config.js';
import type { AgentStackConfig } from '../../src/types.js';

export const TEST_DB_PATH = join(process.cwd(), 'tests/integration/test-data/test.db');
export const TEST_DATA_DIR = join(process.cwd(), 'tests/integration/test-data');

/**
 * Create a test configuration
 */
export function createTestConfig(): AgentStackConfig {
  const config = getDefaultConfig();

  // Use test database
  config.memory.path = TEST_DB_PATH;

  // Use a test provider (OpenAI with mock if no API key)
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.warn('No API keys found. Integration tests may fail or be skipped.');
  }

  return config;
}

/**
 * Setup test environment
 */
export function setupTestEnv(): void {
  // Create test data directory
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }

  // Clean up old test database
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH, { force: true });
  }

  // Remove WAL files too
  const walFiles = [
    `${TEST_DB_PATH}-wal`,
    `${TEST_DB_PATH}-shm`,
  ];

  for (const file of walFiles) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  }
}

/**
 * Cleanup test environment
 */
export function cleanupTestEnv(): void {
  // Remove test database
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH, { force: true });
  }

  // Remove WAL files
  const walFiles = [
    `${TEST_DB_PATH}-wal`,
    `${TEST_DB_PATH}-shm`,
  ];

  for (const file of walFiles) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  }
}
