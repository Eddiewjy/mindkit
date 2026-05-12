import { describe, it, expect } from 'vitest'
import { resolveLLM, toLLMCallFn } from '../llm/resolve-llm'

describe('resolveLLM', () => {
  const env = {
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  }

  it('creates adapter when OPENAI_API_KEY is set', () => {
    const adapter = resolveLLM(env)
    expect(adapter).toBeDefined()
    expect(adapter.maxContextTokens).toBeGreaterThan(0)
  })

  it('respects OPENAI_MODEL env var', () => {
    const adapter = resolveLLM({ ...env, OPENAI_MODEL: 'gpt-4o' })
    expect(adapter).toBeDefined()
  })

  it('throws when OPENAI_API_KEY is missing', () => {
    expect(() => resolveLLM({})).toThrow('OPENAI_API_KEY')
  })

  it('respects OPENAI_MAX_CONTEXT_TOKENS env var', () => {
    const adapter = resolveLLM({
      ...env,
      OPENAI_MAX_CONTEXT_TOKENS: '50000',
    })
    expect(adapter.maxContextTokens).toBe(50000)
  })
})

describe('toLLMCallFn', () => {
  it('wraps LLMAdapter.complete into a LLMCallFn returning content', async () => {
    const mockAdapter = {
      maxContextTokens: 100_000,
      complete: async () => ({ content: 'test response' }),
    }
    const callFn = toLLMCallFn(mockAdapter)
    const result = await callFn([{ role: 'user', content: 'hello' }])
    expect(result).toBe('test response')
  })

  it('returns empty string when content is null', async () => {
    const mockAdapter = {
      maxContextTokens: 100_000,
      complete: async () => ({ content: null }),
    }
    const callFn = toLLMCallFn(mockAdapter)
    const result = await callFn([{ role: 'user', content: 'hello' }])
    expect(result).toBe('')
  })
})
