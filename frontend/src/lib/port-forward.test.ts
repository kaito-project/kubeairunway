import { describe, it, expect } from 'vitest'
import { buildPortForwardCommand } from '@airunway/shared'

describe('buildPortForwardCommand', () => {
  it('uses the frontend service port for AIKit llama.cpp deployments', () => {
    const command = buildPortForwardCommand({
      name: 'llama3-2-1b-3aeb',
      namespace: 'kaito-workspace',
      frontendService: 'llama3-2-1b-3aeb:80',
    })

    expect(command).toBe('kubectl port-forward svc/llama3-2-1b-3aeb 8000:80 -n kaito-workspace')
  })

  it('respects an explicitly encoded frontend service port', () => {
    const command = buildPortForwardCommand({
      name: 'qwen3-0-6b-vllm-abc123',
      namespace: 'airunway-system',
      frontendService: 'qwen3-0-6b-vllm-abc123-frontend:9000',
    })

    expect(command).toBe('kubectl port-forward svc/qwen3-0-6b-vllm-abc123-frontend 8000:9000 -n airunway-system')
  })
})
