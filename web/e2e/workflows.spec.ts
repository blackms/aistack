import { test, expect } from '@playwright/test';

test.describe('Workflows Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workflows');
  });

  test('should display workflows page', async ({ page }) => {
    await expect(page).toHaveURL('/workflows');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  });

  test('should show available workflows section', async ({ page }) => {
    await expect(page.getByText('Available Workflows')).toBeVisible();
  });

  test('should show review loops section', async ({ page }) => {
    await expect(page.getByText('Review Loops')).toBeVisible();
    await expect(page.getByRole('button', { name: /New Review Loop/i })).toBeVisible();
  });

  test('should open review loop dialog', async ({ page }) => {
    // Click New Review Loop button
    await page.getByRole('button', { name: /New Review Loop/i }).click();

    // Dialog should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Launch Review Loop')).toBeVisible();

    // Should have code requirements field
    await expect(page.getByLabel(/Code Requirements/i)).toBeVisible();

    // Should have max iterations field
    await expect(page.getByLabel(/Max Iterations/i)).toBeVisible();

    // Close dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should validate code requirements input', async ({ page }) => {
    // Open review loop dialog
    await page.getByRole('button', { name: /New Review Loop/i }).click();

    // Try to create without code input
    const createButton = page.getByRole('button', { name: /Start Review Loop/i });
    await expect(createButton).toBeDisabled();

    // Enter code requirements
    await page.getByLabel(/Code Requirements/i).fill('Test code requirements');

    // Button should now be enabled
    await expect(createButton).toBeEnabled();
  });

  test('should adjust max iterations', async ({ page }) => {
    // Open review loop dialog
    await page.getByRole('button', { name: /New Review Loop/i }).click();

    const iterationsInput = page.getByLabel(/Max Iterations/i);

    // Should have default value
    await expect(iterationsInput).toHaveValue('3');

    // Change to 5
    await iterationsInput.clear();
    await iterationsInput.fill('5');
    await expect(iterationsInput).toHaveValue('5');
  });

  test('should show refresh button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible();
  });

  test('should refresh workflows and loops', async ({ page }) => {
    // Click refresh button
    await page.getByRole('button', { name: /Refresh/i }).click();

    // Wait for potential loading state
    await page.waitForTimeout(500);
  });
});
