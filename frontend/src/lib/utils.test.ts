import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cn, formatRelativeTime, generateDeploymentName } from './utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz')
  })

  it('handles arrays', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('merges Tailwind classes correctly', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles undefined and null', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns seconds ago for less than 60 seconds', () => {
    const now = new Date('2024-01-01T12:00:30Z')
    vi.setSystemTime(now)
    
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date.toISOString())).toBe('30s ago')
  })

  it('returns minutes ago for less than 60 minutes', () => {
    const now = new Date('2024-01-01T12:05:00Z')
    vi.setSystemTime(now)
    
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date.toISOString())).toBe('5m ago')
  })

  it('returns hours ago for less than 24 hours', () => {
    const now = new Date('2024-01-01T15:00:00Z')
    vi.setSystemTime(now)
    
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date.toISOString())).toBe('3h ago')
  })

  it('returns days ago for 24 hours or more', () => {
    const now = new Date('2024-01-03T12:00:00Z')
    vi.setSystemTime(now)
    
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date.toISOString())).toBe('2d ago')
  })

  it('handles edge case at 0 seconds', () => {
    const now = new Date('2024-01-01T12:00:00Z')
    vi.setSystemTime(now)
    
    expect(formatRelativeTime(now.toISOString())).toBe('0s ago')
  })

  it('handles edge case at exactly 60 seconds', () => {
    const now = new Date('2024-01-01T12:01:00Z')
    vi.setSystemTime(now)
    
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date.toISOString())).toBe('1m ago')
  })

  it('handles edge case at exactly 1 hour', () => {
    const now = new Date('2024-01-01T13:00:00Z')
    vi.setSystemTime(now)
    
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date.toISOString())).toBe('1h ago')
  })

  it('handles edge case at exactly 24 hours', () => {
    const now = new Date('2024-01-02T12:00:00Z')
    vi.setSystemTime(now)
    
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date.toISOString())).toBe('1d ago')
  })
})

describe('generateDeploymentName', () => {
  it('generates a name from a simple model ID', () => {
    const name = generateDeploymentName('Qwen/Qwen3-0.6B')
    expect(name).toMatch(/^qwen3-0-6b-[a-z0-9]{4}$/)
  })

  it('generates a name from model ID with special characters', () => {
    const name = generateDeploymentName('meta-llama/Llama-3.2-1B-Instruct')
    expect(name).toMatch(/^llama-3-2-1b-instruct-[a-z0-9]{4}$/)
  })

  it('truncates long model names to 40 characters', () => {
    const longModelId = 'organization/very-long-model-name-that-exceeds-forty-characters-significantly'
    const name = generateDeploymentName(longModelId)
    // Base name (40 chars max) + '-' + suffix (4 chars) = max 45 chars
    expect(name.length).toBeLessThanOrEqual(45)
    // Verify the base name portion doesn't exceed 40 chars
    const baseName = name.split('-').slice(0, -1).join('-')
    expect(baseName.length).toBeLessThanOrEqual(40)
  })

  it('handles model ID without organization prefix', () => {
    const name = generateDeploymentName('TinyLlama')
    expect(name).toMatch(/^tinyllama-[a-z0-9]{4}$/)
  })

  it('removes consecutive dashes', () => {
    const name = generateDeploymentName('org/model--name')
    expect(name).not.toContain('--')
  })

  it('removes leading and trailing dashes from base name', () => {
    const name = generateDeploymentName('org/-model-name-')
    const baseName = name.split('-').slice(0, -1).join('-')
    expect(baseName).not.toMatch(/^-/)
    expect(baseName).not.toMatch(/-$/)
  })

  it('generates unique names with random suffix', () => {
    const name1 = generateDeploymentName('test/model')
    const name2 = generateDeploymentName('test/model')
    // Names may or may not be different due to random suffix, but format should be consistent
    expect(name1).toMatch(/^model-[a-z0-9]{4}$/)
    expect(name2).toMatch(/^model-[a-z0-9]{4}$/)
  })

  it('converts uppercase to lowercase', () => {
    const name = generateDeploymentName('Org/ModelName')
    expect(name).toMatch(/^[a-z0-9-]+$/)
  })

  it('uses default name for empty model ID', () => {
    const name = generateDeploymentName('')
    expect(name).toMatch(/^deployment-[a-z0-9]{4}$/)
  })
})
