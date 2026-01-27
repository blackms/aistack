#!/usr/bin/env node
/**
 * Merge coverage reports from unit and integration tests
 *
 * This script merges lcov coverage reports from:
 * - coverage/unit/lcov.info
 * - coverage/integration/lcov.info
 *
 * Output: coverage/lcov.info (merged)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COVERAGE_DIR = path.join(__dirname, '..', 'coverage');
const UNIT_COVERAGE = path.join(COVERAGE_DIR, 'unit', 'lcov.info');
const INTEGRATION_COVERAGE = path.join(COVERAGE_DIR, 'integration', 'lcov.info');
const MERGED_COVERAGE = path.join(COVERAGE_DIR, 'lcov.info');

function mergeLcovFiles() {
  console.log('Merging coverage reports...');

  const files = [UNIT_COVERAGE, INTEGRATION_COVERAGE];
  let mergedContent = '';

  for (const file of files) {
    if (fs.existsSync(file)) {
      console.log(`  Reading: ${path.relative(process.cwd(), file)}`);
      const content = fs.readFileSync(file, 'utf-8');
      mergedContent += content;

      // Add separator between files
      if (!content.endsWith('\n')) {
        mergedContent += '\n';
      }
    } else {
      console.warn(`  Warning: ${path.relative(process.cwd(), file)} not found`);
    }
  }

  if (mergedContent) {
    // Ensure coverage directory exists
    if (!fs.existsSync(COVERAGE_DIR)) {
      fs.mkdirSync(COVERAGE_DIR, { recursive: true });
    }

    fs.writeFileSync(MERGED_COVERAGE, mergedContent);
    console.log(`  Merged: ${path.relative(process.cwd(), MERGED_COVERAGE)}`);
    console.log('Coverage merge complete!');
  } else {
    console.error('Error: No coverage files found to merge');
    process.exit(1);
  }
}

try {
  mergeLcovFiles();
} catch (error) {
  console.error('Error merging coverage:', error.message);
  process.exit(1);
}
