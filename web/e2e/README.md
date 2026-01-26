# E2E Tests for AgentStack Web Dashboard

This directory contains end-to-end tests for the AgentStack web dashboard using Playwright.

## Setup

1. Install dependencies:
```bash
cd web
npm install
npx playwright install
```

## Running Tests

### Run all tests (headless mode)
```bash
npm run test:e2e
```

### Run tests in UI mode (interactive)
```bash
npm run test:e2e:ui
```

### Run specific test file
```bash
npx playwright test navigation.spec.ts
```

### Run tests in headed mode (see browser)
```bash
npx playwright test --headed
```

### Run tests in debug mode
```bash
npx playwright test --debug
```

### View test report
```bash
npm run test:e2e:report
```

## Test Structure

- `navigation.spec.ts` - Tests for page navigation and routing
- `dashboard.spec.ts` - Tests for dashboard page functionality
- `agents.spec.ts` - Tests for agent management UI
- `sessions.spec.ts` - Tests for session management UI
- `workflows.spec.ts` - Tests for workflows and review loops UI
- `memory.spec.ts` - Tests for memory management UI

## Prerequisites

Before running E2E tests, ensure:

1. **Backend server is running**: The API server should be running and accessible
2. **Frontend dev server**: The Playwright config will auto-start the dev server on port 5173
3. **Database**: Ensure the SQLite database is initialized

## CI/CD

Tests are configured to run in CI with:
- Chromium only (to reduce CI time)
- Automatic retries (2 retries)
- HTML reporter output

## Writing New Tests

Follow these patterns:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/your-page');
  });

  test('should do something', async ({ page }) => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Tips

- Use `data-testid` attributes for more stable selectors
- Keep tests independent and isolated
- Use Page Object Model for complex interactions
- Avoid hard waits (`waitForTimeout`) when possible
- Prefer explicit waits (`waitForSelector`, `waitForLoadState`)

## Debugging

- Use `await page.pause()` to pause test execution
- Use `--debug` flag to step through tests
- Check `test-results/` for screenshots and traces on failures
- Use `trace: 'on'` in config to always record traces
