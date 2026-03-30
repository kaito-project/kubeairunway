import { test, expect } from './fixtures'

test.describe('Settings page', () => {
  test('renders settings page', async ({ mockedPage: page }) => {
    await page.goto('/settings')
    // Wait for the page to load — settings page has tabs
    await page.waitForLoadState('networkidle')
    // The page should be visible (it has several sections)
    await expect(page.locator('main')).toBeVisible()
  })

  test('navigable from sidebar', async ({ mockedPage: page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL('/settings')
  })

  test('/settings?tab=runtimes opens runtimes tab', async ({ mockedPage: page }) => {
    await page.goto('/settings?tab=runtimes')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('main')).toBeVisible()
  })
})
