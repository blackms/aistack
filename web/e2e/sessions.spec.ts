import { test, expect } from '@playwright/test';

test.describe('Sessions Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sessions');
  });

  test('should display sessions page', async ({ page }) => {
    await expect(page).toHaveURL('/sessions');
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  });

  test('should have tabs for filtering sessions', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'All Sessions' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Active' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Ended' })).toBeVisible();
  });

  test('should show create session button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /New Session/i })).toBeVisible();
  });

  test('should open create session dialog', async ({ page }) => {
    // Click the "New Session" button
    await page.getByRole('button', { name: /New Session/i }).click();

    // Dialog should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Create New Session')).toBeVisible();
    await expect(page.getByLabel(/Metadata/i)).toBeVisible();

    // Close dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should switch between tabs', async ({ page }) => {
    // Click Active tab
    await page.getByRole('tab', { name: 'Active' }).click();
    // Wait for tab panel to update
    await page.waitForTimeout(500);

    // Click Ended tab
    await page.getByRole('tab', { name: 'Ended' }).click();
    await page.waitForTimeout(500);

    // Click All Sessions tab
    await page.getByRole('tab', { name: 'All Sessions' }).click();
    await page.waitForTimeout(500);
  });

  test('should validate JSON metadata input', async ({ page }) => {
    // Open create dialog
    await page.getByRole('button', { name: /New Session/i }).click();

    // Enter invalid JSON
    await page.getByLabel(/Metadata/i).fill('{ invalid json }');

    // Try to create
    await page.getByRole('button', { name: /Create Session/i }).click();

    // Should show error
    await expect(page.getByText(/Invalid JSON/i)).toBeVisible();
  });
});
