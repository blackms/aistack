import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only include unit tests - integration tests use vitest.integration.config.ts
    include: ['tests/unit/**/*.test.ts'],
    // Enable parallel execution with thread pool
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        // Let Vitest determine optimal worker count based on CPU cores
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/index.ts',
        '**/types.ts',
        'src/cli/**',
      ],
    },
  },
});
