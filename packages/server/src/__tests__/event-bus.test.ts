import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../events/event-bus'
import type { SpaceEvent } from '../events/event-bus'

describe('EventBus', () => {
  it('emits events to listeners', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.on(listener)

    const event: SpaceEvent = {
      id: 'e1',
      at: new Date().toISOString(),
      kind: 'node_forked',
      payload: { nodeId: 'n1', label: 'Test', parentId: 'root' },
    }
    bus.emit(event)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it('stores history up to max limit', () => {
    const bus = new EventBus(3)
    bus.emit({ id: '1', at: '', kind: 'node_forked', payload: {} })
    bus.emit({ id: '2', at: '', kind: 'node_forked', payload: {} })
    bus.emit({ id: '3', at: '', kind: 'node_forked', payload: {} })
    bus.emit({ id: '4', at: '', kind: 'node_forked', payload: {} })
    expect(bus.getHistory()).toHaveLength(3)
    expect(bus.getHistory()[0]!.id).toBe('2')
  })

  it('off removes listener', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.on(listener)
    bus.off(listener)
    bus.emit({ id: '1', at: '', kind: 'node_forked', payload: {} })
    expect(listener).not.toHaveBeenCalled()
  })
})
