import { useEffect } from 'react'
import { useSettings } from './useSettings'

// Provider color themes (HSL values)
const providerThemes = {
  dynamo: {
    // NVIDIA Green
    primary: '79 100% 36%',
    ring: '79 100% 36%',
    accent: '79 50% 90%',
    accentDark: '79 30% 20%',
  },
  kuberay: {
    // Ray Blue
    primary: '217 91% 60%',
    ring: '217 91% 60%',
    accent: '217 50% 90%',
    accentDark: '217 30% 20%',
  },
} as const

type ProviderId = keyof typeof providerThemes

export function useProviderTheme() {
  const { data: settings } = useSettings()
  const providerId = (settings?.activeProvider?.id || 'dynamo') as ProviderId

  useEffect(() => {
    const theme = providerThemes[providerId] || providerThemes.dynamo
    const root = document.documentElement

    // Update CSS variables
    root.style.setProperty('--primary', theme.primary)
    root.style.setProperty('--ring', theme.ring)

    // Check if dark mode
    const isDark = root.classList.contains('dark')
    root.style.setProperty('--accent', isDark ? theme.accentDark : theme.accent)

    // Add provider class for additional styling
    root.dataset.provider = providerId

    return () => {
      // Cleanup on unmount
      root.style.removeProperty('--primary')
      root.style.removeProperty('--ring')
      root.style.removeProperty('--accent')
      delete root.dataset.provider
    }
  }, [providerId])

  return { providerId }
}
