import { test, expect } from '@playwright/test';

test.describe('Memory Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/memory');
  });

  test('should display memory page', async ({ page }) => {
    await expect(page).toHaveURL('/memory');
    await expect(page.getByRole('heading', { name: 'Memory' })).toBeVisible();
  });

  test('should have search functionality', async ({ page }) => {
    // Check for search input
    const searchInput = page.getByPlaceholder(/Search/i);
    await expect(searchInput).toBeVisible();
  });

  test('should show store entry button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Store Entry/i })).toBeVisible();
  });

  test('should open store entry dialog', async ({ page }) => {
    // Click store button
    await page.getByRole('button', { name: /Store Entry/i }).click();

    // Dialog should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/Store Memory Entry/i)).toBeVisible();

    // Should have key, content, and namespace fields
    await expect(page.getByLabel(/Key/i)).toBeVisible();
    await expect(page.getByLabel(/Content/i)).toBeVisible();

    // Close dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should have refresh button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
  });

  test('should refresh memory entries', async ({ page }) => {
    // Click refresh button
    await page.getByRole('button', { name: /Refresh/i }).click();

    // Wait for potential loading state
    await page.waitForTimeout(500);
  });
});
