import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
  });

  test('should display dashboard', async ({ page }) => {
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('should show system status card', async ({ page }) => {
    await expect(page.getByText('System Status')).toBeVisible();
  });

  test('should show active agents card', async ({ page }) => {
    await expect(page.getByText('Active Agents')).toBeVisible();
  });

  test('should show task queue card', async ({ page }) => {
    await expect(page.getByText('Task Queue')).toBeVisible();
  });

  test('should show memory usage card', async ({ page }) => {
    await expect(page.getByText('Memory Usage')).toBeVisible();
  });

  test('should have quick actions', async ({ page }) => {
    // Check for quick action buttons
    const agentsButton = page.getByRole('link', { name: /View Agents/i });
    const tasksButton = page.getByRole('link', { name: /View Tasks/i });

    // At least some quick action buttons should be visible
    const hasQuickActions = await agentsButton.isVisible().catch(() => false) ||
                            await tasksButton.isVisible().catch(() => false);
    expect(hasQuickActions).toBeTruthy();
  });
});
