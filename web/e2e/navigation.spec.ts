import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate to all main pages', async ({ page }) => {
    // Start at the home page
    await page.goto('/');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Navigate to Projects
    await page.getByRole('link', { name: 'Projects' }).click();
    await expect(page).toHaveURL('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

    // Navigate to Agents
    await page.getByRole('link', { name: 'Agents' }).click();
    await expect(page).toHaveURL('/agents');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();

    // Navigate to Memory
    await page.getByRole('link', { name: 'Memory' }).click();
    await expect(page).toHaveURL('/memory');
    await expect(page.getByRole('heading', { name: 'Memory' })).toBeVisible();

    // Navigate to Tasks
    await page.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL('/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();

    // Navigate to Workflows
    await page.getByRole('link', { name: 'Workflows' }).click();
    await expect(page).toHaveURL('/workflows');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

    // Navigate to Sessions
    await page.getByRole('link', { name: 'Sessions' }).click();
    await expect(page).toHaveURL('/sessions');
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // Navigate to Chat
    await page.getByRole('link', { name: 'Chat' }).click();
    await expect(page).toHaveURL('/chat');
    await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();
  });

  test('should show WebSocket connection status', async ({ page }) => {
    await page.goto('/');

    // Check for connection status chip
    const statusChip = page.getByText(/Connected|Disconnected/);
    await expect(statusChip).toBeVisible();
  });
});
