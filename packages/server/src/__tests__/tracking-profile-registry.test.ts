import { describe, it, expect } from 'vitest'
import { TrackingProfileRegistry } from '../space/tracking-profile-registry'

describe('TrackingProfileRegistry', () => {
  it('tracks last resolved profile name', () => {
    const registry = new TrackingProfileRegistry()
    registry.register('idea-deep-dive', { systemPrompt: 'test' })
    registry.get('idea-deep-dive')
    expect(registry.consumeLastResolved()).toBe('idea-deep-dive')
  })

  it('returns null after consuming', () => {
    const registry = new TrackingProfileRegistry()
    registry.register('idea-deep-dive', { systemPrompt: 'test' })
    registry.get('idea-deep-dive')
    registry.consumeLastResolved()
    expect(registry.consumeLastResolved()).toBeNull()
  })

  it('does not track failed lookups', () => {
    const registry = new TrackingProfileRegistry()
    registry.get('nonexistent')
    expect(registry.consumeLastResolved()).toBeNull()
  })

  it('tracks the most recent successful lookup', () => {
    const registry = new TrackingProfileRegistry()
    registry.register('a', { systemPrompt: 'a' })
    registry.register('b', { systemPrompt: 'b' })
    registry.get('a')
    registry.get('b')
    expect(registry.consumeLastResolved()).toBe('b')
  })
})
