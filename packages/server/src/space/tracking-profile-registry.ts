import { ForkProfileRegistryImpl } from '@stello-ai/core'
import type { ForkProfile } from '@stello-ai/core'

/** 追踪最近一次 get() 命中的 profile name，用于在 onSessionFork 中关联 profile */
export class TrackingProfileRegistry extends ForkProfileRegistryImpl {
  private _lastResolved: string | null = null

  get(name: string): ForkProfile | undefined {
    const result = super.get(name)
    if (result) this._lastResolved = name
    return result
  }

  /** 消费并返回最近一次成功 get() 的 profile name，调用后重置为 null */
  consumeLastResolved(): string | null {
    const name = this._lastResolved
    this._lastResolved = null
    return name
  }
}
