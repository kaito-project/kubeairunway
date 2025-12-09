import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, RenderOptions } from '@testing-library/react'

/**
 * Create a new QueryClient for testing with disabled retries
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/**
 * Create a wrapper component with QueryClientProvider for testing hooks
 */
export function createWrapper() {
  const queryClient = createTestQueryClient()
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

/**
 * Custom render function that includes QueryClientProvider
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const queryClient = createTestQueryClient()
  
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  }
}

export * from '@testing-library/react'
