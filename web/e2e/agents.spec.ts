import { test, expect } from '@playwright/test';

test.describe('Agents Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/agents');
  });

  test('should display agents page', async ({ page }) => {
    await expect(page).toHaveURL('/agents');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  });

  test('should show spawn agent button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Spawn Agent/i })).toBeVisible();
  });

  test('should show refresh button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
  });

  test('should open spawn agent dialog', async ({ page }) => {
    // Click spawn button
    await page.getByRole('button', { name: /Spawn Agent/i }).click();

    // Dialog should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Spawn Agent')).toBeVisible();

    // Should have agent type selector
    await expect(page.getByLabel(/Agent Type/i)).toBeVisible();

    // Should have optional name field
    await expect(page.getByLabel(/Agent Name/i)).toBeVisible();

    // Close dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should refresh agents list', async ({ page }) => {
    // Click refresh button
    await page.getByRole('button', { name: /Refresh/i }).click();

    // Wait for potential loading state
    await page.waitForTimeout(500);
  });
});
