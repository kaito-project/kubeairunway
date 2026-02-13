import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function generateDeploymentName(modelId: string): string {
  const baseName = modelId
    .split('/').pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'deployment'

  const suffix = Math.random().toString(36).substring(2, 6)
  return `${baseName}-${suffix}`
}

/**
 * Ayna deep link configuration (unified flow)
 * URL Pattern: ayna://chat?model={model}&prompt={message}&system={system}&provider={provider}&endpoint={url}&key={apikey}&type={type}
 */
export interface AynaOptions {
  // Chat parameters
  model?: string
  prompt?: string
  system?: string
  // Model setup parameters
  provider?: 'openai' | 'azure' | 'github' | 'aikit'
  endpoint?: string
  key?: string
  type?: 'chat' | 'responses' | 'image'
}

/**
 * Generate an Ayna deep link URL (unified flow for chat + model setup)
 * URL Pattern: ayna://chat?model={model}&prompt={message}&system={system}&provider={provider}&endpoint={url}&key={apikey}&type={type}
 */
export function generateAynaUrl(options: AynaOptions = {}): string {
  const params = new URLSearchParams()
  if (options.model) params.set('model', options.model)
  if (options.prompt) params.set('prompt', options.prompt)
  if (options.system) params.set('system', options.system)
  if (options.provider) params.set('provider', options.provider)
  if (options.endpoint) params.set('endpoint', options.endpoint)
  if (options.key) params.set('key', options.key)
  if (options.type) params.set('type', options.type)
  
  const queryString = params.toString()
  return `ayna://chat${queryString ? `?${queryString}` : ''}`
}
