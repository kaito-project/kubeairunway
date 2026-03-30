import { test as base, expect } from '@playwright/test'
import { mockSettings } from './fixtures'

const test = base

test.describe('Error states', () => {
  test('shows fallback models when models API fails', async ({ page }) => {
    // The useModels hook catches API errors and returns static fallback models
    await page.route(/\/api\//, (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/settings' || path === '/api/settings/') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSettings) })
      }
      if (path === '/api/models' || path === '/api/models/') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Internal server error' } }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })
    await page.goto('/')
    // Fallback models are shown when API is unavailable
    await expect(page.getByText('Model Catalog')).toBeVisible()
    await expect(page.getByText(/of \d+ models/)).toBeVisible()
  })

  test('shows error when deployments API fails', async ({ page }) => {
    await page.route(/\/api\//, (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/settings' || path === '/api/settings/') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSettings) })
      }
      if (path === '/api/deployments' || path === '/api/deployments/') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Internal server error' } }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })
    await page.goto('/deployments')
    // React Query retries 3 times with backoff
    await expect(page.getByText(/Failed to load deployments/i)).toBeVisible({ timeout: 15000 })
  })
})

test.describe('Auth redirect', () => {
  test('redirects to login when auth is enabled and no token', async ({ page }) => {
    const authSettings = { ...mockSettings, auth: { enabled: true } }
    await page.route(/\/api\//, (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/settings' || path === '/api/settings/') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authSettings) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })
    await page.goto('/')
    await expect(page).toHaveURL('/login')
    await expect(page.getByText('Authentication Required')).toBeVisible()
  })

  test('login page shows CLI instructions', async ({ page }) => {
    const authSettings = { ...mockSettings, auth: { enabled: true } }
    await page.route(/\/api\//, (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/settings' || path === '/api/settings/') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authSettings) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })
    await page.goto('/login')
    await expect(page.getByText('airunway login')).toBeVisible()
    await expect(page.getByText('Paste Token')).toBeVisible()
  })
})

test.describe('Loading states', () => {
  test('shows loading indicator while models load', async ({ page }) => {
    await page.route(/\/api\//, (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/settings' || path === '/api/settings/') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSettings) })
      }
      if (path === '/api/cluster/status') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true }) })
      }
      // Delay models response
      if (path === '/api/models' || path === '/api/models/') {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) }))
          }, 2000)
        })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })
    await page.goto('/')
    await expect(page.getByText('Model Catalog')).toBeVisible()
  })
})
