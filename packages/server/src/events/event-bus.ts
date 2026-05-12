/** 系统事件类型 */
export type SpaceEventKind =
  | 'node_forked'
  | 'memory_consolidated'
  | 'global_integrated'
  | 'insight_pushed'
  | 'association_found'
  | 'contradiction_detected'
  | 'artifact_created'
  | 'artifact_updated'
  | 'node_activated'

/** Space 内的系统事件 */
export interface SpaceEvent {
  id: string
  at: string
  kind: SpaceEventKind
  payload: Record<string, unknown>
}

export type SpaceEventListener = (event: SpaceEvent) => void

/** Space 级事件总线（内存，不持久化） */
export class EventBus {
  private readonly listeners = new Set<SpaceEventListener>()
  private readonly history: SpaceEvent[] = []
  private readonly maxHistory: number

  constructor(maxHistory = 500) {
    this.maxHistory = maxHistory
  }

  /** 订阅事件 */
  on(listener: SpaceEventListener): void {
    this.listeners.add(listener)
  }

  /** 取消订阅 */
  off(listener: SpaceEventListener): void {
    this.listeners.delete(listener)
  }

  /** 广播事件 */
  emit(event: SpaceEvent): void {
    this.history.push(event)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** 获取事件历史 */
  getHistory(): SpaceEvent[] {
    return [...this.history]
  }
}
