const { test, expect } = require('@playwright/test');

test('dashboard recovers automatically from a transient initial API failure', async ({ page }) => {
  let sessionAttempts = 0;
  await page.route('**/api/session', async route => {
    sessionAttempts += 1;
    if (sessionAttempts === 1) {
      await route.abort('connectionrefused');
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Field updates', exact: true })).toBeVisible();
  expect(sessionAttempts).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('Failed to fetch', { exact: true })).toHaveCount(0);
});
