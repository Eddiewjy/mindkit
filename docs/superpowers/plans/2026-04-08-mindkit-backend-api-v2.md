# MindKit 后端 API V2 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Space CRUD + Chat 基础上补全 demo 所需的拓扑、产物、事件流、Space 配置扩展 API

**Architecture:** 扩展 SpaceMeta 字段 → 更新 SpaceFactory 合并 Space 级 forkProfiles/skills → 新增 topology/artifacts/events REST 端点 → 在现有 WS 上复用 EventBus 推送系统事件。拓扑数据直接复用 core 层 `SessionTree.getTree()`。产物由 Agent tool 写入文件系统，REST 只读。

**Tech Stack:** TypeScript · Hono · Vitest · @stello-ai/core (SessionTree, MemoryEngine, ForkProfileRegistry, SkillRouter)

**Spec:** `docs/superpowers/specs/2026-04-08-mindkit-backend-api-v2-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/space/space-manager.ts` | Modify | SpaceMeta 字段扩展 + PATCH 逻辑 |
| `src/space/space-factory.ts` | Modify | 合并 Space 级 forkProfiles/skills 到 registries |
| `src/api/routes.ts` | Modify | 新增 PATCH spaces, topology, artifacts, events 端点 |
| `src/api/ws-handler.ts` | Modify | WS 推送 space_event 消息 |
| `src/events/event-bus.ts` | Create | Space 级 EventBus（参考 devtools） |
| `src/artifacts/artifact-store.ts` | Create | 产物文件系统读取（Agent 写、REST 读） |
| `src/__tests__/space-manager-v2.test.ts` | Create | SpaceMeta 扩展 + PATCH 测试 |
| `src/__tests__/event-bus.test.ts` | Create | EventBus 单测 |
| `src/__tests__/artifact-store.test.ts` | Create | ArtifactStore 单测 |
| `src/__tests__/routes-v2.test.ts` | Create | 新端点集成测试 |

---

## Task 1: SpaceMeta 字段扩展 + PATCH

扩展 `SpaceMeta` 接口，更新 `createSpace` 接受新字段，新增 `updateSpace` 方法。

**Files:**
- Modify: `src/space/space-manager.ts`
- Test: `src/__tests__/space-manager-v2.test.ts`

- [ ] **Step 1: 写 SpaceMeta 扩展的失败测试**

```typescript
// src/__tests__/space-manager-v2.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SpaceManager } from '../space/space-manager'
import type { PresetConfig } from '../preset/preset-loader'

const TEST_PRESET: PresetConfig = {
  dirName: 'test-preset',
  name: 'Test Preset',
  description: 'A test preset',
  systemPrompt: 'You are a test assistant.',
  forkProfiles: [],
  skills: [],
  llm: { model: 'claude-test' },
  consolidatePrompt: null,
  integratePrompt: null,
}

describe('SpaceMeta V2 fields', () => {
  let spacesDir: string
  let manager: SpaceManager

  beforeEach(async () => {
    spacesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-test-'))
    manager = new SpaceManager({ spacesDir, presets: [TEST_PRESET], env: {} })
  })

  afterEach(async () => {
    await fs.rm(spacesDir, { recursive: true, force: true })
  })

  it('createSpace accepts extended fields', async () => {
    const meta = await manager.createSpace('Kit', 'test-preset', {
      emoji: '🚀',
      color: '#ff0000',
      description: 'A hackathon kit',
      mode: 'PRO',
      expectedArtifacts: 'PRD and tech spec',
    })
    expect(meta.emoji).toBe('🚀')
    expect(meta.color).toBe('#ff0000')
    expect(meta.description).toBe('A hackathon kit')
    expect(meta.mode).toBe('PRO')
    expect(meta.expectedArtifacts).toBe('PRD and tech spec')
  })

  it('createSpace uses defaults for omitted fields', async () => {
    const meta = await manager.createSpace('Kit', 'test-preset')
    expect(meta.emoji).toBe('🧠')
    expect(meta.color).toBe('#6366f1')
    expect(meta.mode).toBe('AUTO')
    expect(meta.description).toBeUndefined()
  })

  it('updateSpace patches specific fields', async () => {
    const meta = await manager.createSpace('Kit', 'test-preset')
    const updated = await manager.updateSpace(meta.id, {
      name: 'Renamed Kit',
      emoji: '🎯',
      mode: 'PRO',
    })
    expect(updated.name).toBe('Renamed Kit')
    expect(updated.emoji).toBe('🎯')
    expect(updated.mode).toBe('PRO')
    // 未修改的字段保持不变
    expect(updated.color).toBe('#6366f1')
    expect(updated.createdAt).toBe(meta.createdAt)
  })

  it('updateSpace returns null for non-existent space', async () => {
    const result = await manager.updateSpace('no-such-id', { name: 'X' })
    expect(result).toBeNull()
  })

  it('updateSpace persists changes to meta.json', async () => {
    const meta = await manager.createSpace('Kit', 'test-preset')
    await manager.updateSpace(meta.id, { description: 'Updated' })
    // 重新读取验证持久化
    const reloaded = await manager.getSpace(meta.id)
    expect(reloaded!.description).toBe('Updated')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run src/__tests__/space-manager-v2.test.ts`
Expected: FAIL — `createSpace` 不接受第三参数，`updateSpace` 不存在

- [ ] **Step 3: 扩展 SpaceMeta 接口和 createSpace**

在 `src/space/space-manager.ts` 中：

1. 扩展 `SpaceMeta` 接口新增 `emoji`, `color`, `description?`, `mode`, `expectedArtifacts?`, `forkProfiles?`, `skills?`
2. 新增 `SpaceMetaOptions` 类型为可选创建参数
3. `createSpace(name, presetDirName, options?)` 接受可选配置，设置默认值
4. 新增 `updateSpace(id, patch)` 方法：读取现有 meta → 合并 patch → 写回 meta.json

```typescript
/** Space 创建时的可选配置 */
export interface SpaceCreateOptions {
  emoji?: string
  color?: string
  description?: string
  mode?: 'AUTO' | 'PRO'
  expectedArtifacts?: string
  forkProfiles?: SpaceForkProfile[]
  skills?: SpaceSkill[]
}

/** 预配置 fork 模板节点 */
export interface SpaceForkProfile {
  name: string
  label: string
  systemPrompt?: string
  guidePrompt?: string
  activationHint?: string
  skills?: string[]
}

/** Space 可用的 skill */
export interface SpaceSkill {
  name: string
  description: string
  content: string
}

/** PATCH 可更新的字段 */
export type SpaceUpdatePatch = Partial<Pick<SpaceMeta,
  'name' | 'emoji' | 'color' | 'description' | 'mode' |
  'expectedArtifacts' | 'forkProfiles' | 'skills'
>>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run src/__tests__/space-manager-v2.test.ts`
Expected: PASS

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run`
Expected: 所有测试 PASS（原 space-manager.test.ts 中 `createSpace` 调用签名不变，第三参数可选）

- [ ] **Step 6: 提交**

```bash
cd /home/i/Code/MindKit
git add src/space/space-manager.ts src/__tests__/space-manager-v2.test.ts
git commit -m "feat(server): 扩展 SpaceMeta 字段 + 新增 updateSpace PATCH 方法"
```

---

## Task 2: SpaceFactory 合并 Space 级配置

更新 SpaceFactory，在构建 Agent 时将 `meta.forkProfiles` 和 `meta.skills` 合并到 Stello registries 中。

**Files:**
- Modify: `src/space/space-factory.ts`
- Modify: `src/space/space-manager.ts` — `getAgent` 传入完整 meta

- [ ] **Step 1: 更新 SpaceFactoryContext 接受 SpaceMeta**

在 `space-factory.ts` 中，将 `SpaceFactoryContext.config` 从 `PresetConfig` 改为同时接受 preset 和 space 级覆盖。最简方案：新增 `spaceMeta?: SpaceMeta` 字段。

```typescript
export interface SpaceFactoryContext {
  dataDir: string
  config: PresetConfig
  env: Record<string, string | undefined>
  spaceMeta?: SpaceMeta  // Space 级配置覆盖
}
```

- [ ] **Step 2: 合并 forkProfiles 和 skills**

在 `createSpaceAgent` 中，先注册 preset 的，再注册 spaceMeta 的（后注册覆盖同名项）：

```typescript
// Skills: preset 先注册，space 覆盖
for (const skill of ctx.config.skills) {
  skillRouter.register(skill)
}
if (ctx.spaceMeta?.skills) {
  for (const skill of ctx.spaceMeta.skills) {
    skillRouter.register(skill)  // 同名覆盖
  }
}

// Fork profiles: 同理
for (const fp of ctx.config.forkProfiles) {
  profiles.register(fp.name, { /* ... */ })
}
if (ctx.spaceMeta?.forkProfiles) {
  for (const fp of ctx.spaceMeta.forkProfiles) {
    profiles.register(fp.name, {
      systemPrompt: fp.systemPrompt,
      systemPromptMode: 'prepend',
      skills: fp.skills,
    })
  }
}
```

- [ ] **Step 3: 更新 SpaceManager.getAgent 传入 meta**

`getAgent` 已接受 `meta: SpaceMeta`，只需在调用 `createSpaceAgent` 时传入 `spaceMeta: meta`。

- [ ] **Step 4: Typecheck**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 运行全量测试**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
cd /home/i/Code/MindKit
git add src/space/space-factory.ts src/space/space-manager.ts
git commit -m "feat(server): SpaceFactory 合并 Space 级 forkProfiles 和 skills 配置"
```

---

## Task 3: EventBus

参考 devtools `event-bus.ts` 实现独立的 Space 级 EventBus。

**Files:**
- Create: `src/events/event-bus.ts`
- Test: `src/__tests__/event-bus.test.ts`

- [ ] **Step 1: 写 EventBus 失败测试**

```typescript
// src/__tests__/event-bus.test.ts
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
    expect(bus.getHistory()[0]!.id).toBe('2') // oldest dropped
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run src/__tests__/event-bus.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 EventBus**

```typescript
// src/events/event-bus.ts

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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run src/__tests__/event-bus.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /home/i/Code/MindKit
git add src/events/event-bus.ts src/__tests__/event-bus.test.ts
git commit -m "feat(server): 新增 Space 级 EventBus — 内存事件总线"
```

---

## Task 4: ArtifactStore

产物文件系统存储。Agent 通过 tool 写入 `{spaceDir}/artifacts/{id}.json`，REST 只读。

**Files:**
- Create: `src/artifacts/artifact-store.ts`
- Test: `src/__tests__/artifact-store.test.ts`

- [ ] **Step 1: 写 ArtifactStore 失败测试**

```typescript
// src/__tests__/artifact-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ArtifactStore } from '../artifacts/artifact-store'
import type { ArtifactDetail } from '../artifacts/artifact-store'

describe('ArtifactStore', () => {
  let dir: string
  let store: ArtifactStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-artifact-'))
    store = new ArtifactStore(dir)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('list returns empty when no artifacts', async () => {
    expect(await store.list()).toEqual([])
  })

  it('save and get round-trips artifact', async () => {
    const artifact: ArtifactDetail = {
      id: 'a1',
      title: 'PRD',
      type: 'markdown',
      content: '# Product Requirements',
      sourceNodeIds: ['root'],
      createdAt: '2026-04-08T00:00:00Z',
      updatedAt: '2026-04-08T00:00:00Z',
      editHistory: [],
    }
    await store.save(artifact)
    const loaded = await store.get('a1')
    expect(loaded).not.toBeNull()
    expect(loaded!.title).toBe('PRD')
    expect(loaded!.content).toBe('# Product Requirements')
  })

  it('list returns all artifact metas', async () => {
    await store.save({
      id: 'a1', title: 'PRD', type: 'markdown', content: '# PRD',
      sourceNodeIds: [], createdAt: '', updatedAt: '', editHistory: [],
    })
    await store.save({
      id: 'a2', title: 'Plan', type: 'markdown', content: '# Plan',
      sourceNodeIds: [], createdAt: '', updatedAt: '', editHistory: [],
    })
    const list = await store.list()
    expect(list).toHaveLength(2)
    // list 不含 content
    expect((list[0] as Record<string, unknown>)['content']).toBeUndefined()
  })

  it('get returns null for non-existent artifact', async () => {
    expect(await store.get('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run src/__tests__/artifact-store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 ArtifactStore**

```typescript
// src/artifacts/artifact-store.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** 产物摘要信息（列表用，不含 content） */
export interface ArtifactMeta {
  id: string
  title: string
  type: string
  summary?: string
  sourceNodeIds: string[]
  createdAt: string
  updatedAt: string
}

/** 产物完整详情 */
export interface ArtifactDetail extends ArtifactMeta {
  content: string
  editHistory: { at: string; summary: string }[]
}

/** 文件系统产物存储（Agent 写 + REST 读） */
export class ArtifactStore {
  private readonly dir: string

  constructor(spaceDir: string) {
    this.dir = path.join(spaceDir, 'artifacts')
  }

  /** 列出所有产物摘要 */
  async list(): Promise<ArtifactMeta[]> {
    let files: string[]
    try {
      files = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const metas: ArtifactMeta[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(this.dir, file), 'utf-8')
        const detail = JSON.parse(raw) as ArtifactDetail
        const { content: _, editHistory: __, ...meta } = detail
        metas.push(meta)
      } catch { /* skip malformed */ }
    }
    return metas
  }

  /** 获取单个产物完整内容 */
  async get(id: string): Promise<ArtifactDetail | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir, `${id}.json`), 'utf-8')
      return JSON.parse(raw) as ArtifactDetail
    } catch {
      return null
    }
  }

  /** 保存产物（Agent tool 调用） */
  async save(artifact: ArtifactDetail): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(
      path.join(this.dir, `${artifact.id}.json`),
      JSON.stringify(artifact, null, 2),
    )
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run src/__tests__/artifact-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /home/i/Code/MindKit
git add src/artifacts/artifact-store.ts src/__tests__/artifact-store.test.ts
git commit -m "feat(server): 新增 ArtifactStore — 文件系统产物存储（Agent 写 + REST 读）"
```

---

## Task 5: REST 路由扩展

新增 PATCH spaces、topology、artifacts、events 端点。

**Files:**
- Modify: `src/api/routes.ts`
- Modify: `src/space/space-manager.ts` — 暴露 `getEventBus`, `getArtifactStore`
- Test: `src/__tests__/routes-v2.test.ts`

- [ ] **Step 1: SpaceManager 新增 getEventBus 和 getArtifactStore**

SpaceManager 需要为每个 Space 维护 EventBus 和 ArtifactStore。最简方案：lazily 创建并缓存。

```typescript
// space-manager.ts 新增
private readonly eventBuses: Map<string, EventBus> = new Map()

/** 获取 Space 的 EventBus（懒创建） */
getEventBus(spaceId: string): EventBus {
  let bus = this.eventBuses.get(spaceId)
  if (!bus) {
    bus = new EventBus()
    this.eventBuses.set(spaceId, bus)
  }
  return bus
}

/** 获取 Space 的 ArtifactStore */
getArtifactStore(spaceId: string): ArtifactStore {
  return new ArtifactStore(path.join(this.spacesDir, spaceId))
}
```

- [ ] **Step 2: 在 routes.ts 中新增端点**

```typescript
/** PATCH /spaces/:id — 更新 Space 设置 */
app.patch('/spaces/:id', async (c) => {
  const id = c.req.param('id')
  const patch = await c.req.json<SpaceUpdatePatch>()
  const updated = await spaceManager.updateSpace(id, patch)
  if (!updated) return c.json({ error: 'Space not found' }, 404)
  return c.json(updated)
})

/** GET /spaces/:id/topology — 获取拓扑树 */
app.get('/spaces/:id/topology', async (c) => {
  const id = c.req.param('id')
  const meta = await spaceManager.getSpace(id)
  if (!meta) return c.json({ error: 'Space not found' }, 404)
  const agent = spaceManager.getAgent(id, meta)
  const tree = await agent.sessions.getTree()
  return c.json(tree)
})

/** GET /spaces/:id/artifacts — 产物列表 */
app.get('/spaces/:id/artifacts', async (c) => {
  const id = c.req.param('id')
  const meta = await spaceManager.getSpace(id)
  if (!meta) return c.json({ error: 'Space not found' }, 404)
  const store = spaceManager.getArtifactStore(id)
  const artifacts = await store.list()
  return c.json({ artifacts })
})

/** GET /spaces/:id/artifacts/:aid — 产物详情 */
app.get('/spaces/:id/artifacts/:aid', async (c) => {
  const id = c.req.param('id')
  const aid = c.req.param('aid')
  const meta = await spaceManager.getSpace(id)
  if (!meta) return c.json({ error: 'Space not found' }, 404)
  const store = spaceManager.getArtifactStore(id)
  const artifact = await store.get(aid)
  if (!artifact) return c.json({ error: 'Artifact not found' }, 404)
  return c.json(artifact)
})

/** GET /spaces/:id/events — 事件历史 */
app.get('/spaces/:id/events', async (c) => {
  const id = c.req.param('id')
  const meta = await spaceManager.getSpace(id)
  if (!meta) return c.json({ error: 'Space not found' }, 404)
  const limit = Number(c.req.query('limit') ?? 100)
  const bus = spaceManager.getEventBus(id)
  const events = bus.getHistory().slice(-limit)
  return c.json({ events })
})
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 写路由集成测试**

测试 PATCH spaces 端点（topology/artifacts 端点需要真实 Agent，用 mock 简化）：

```typescript
// src/__tests__/routes-v2.test.ts
// 使用 Hono test client 测试 PATCH /spaces/:id
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SpaceManager } from '../space/space-manager'
import { buildRoutes } from '../api/routes'
import type { PresetConfig } from '../preset/preset-loader'

const TEST_PRESET: PresetConfig = {
  dirName: 'test-preset', name: 'Test', description: '',
  systemPrompt: '', forkProfiles: [], skills: [],
  llm: { model: 'test' }, consolidatePrompt: null, integratePrompt: null,
}

describe('Routes V2', () => {
  let spacesDir: string
  let manager: SpaceManager
  let app: ReturnType<typeof buildRoutes>

  beforeEach(async () => {
    spacesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-routes-'))
    manager = new SpaceManager({ spacesDir, presets: [TEST_PRESET], env: {} })
    app = buildRoutes(manager, [TEST_PRESET])
  })

  afterEach(async () => {
    await fs.rm(spacesDir, { recursive: true, force: true })
  })

  it('PATCH /spaces/:id updates meta', async () => {
    const meta = await manager.createSpace('Kit', 'test-preset')
    const res = await app.request(`/spaces/${meta.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', emoji: '🎯' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed')
    expect(body.emoji).toBe('🎯')
  })

  it('PATCH /spaces/:id returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(404)
  })

  it('GET /spaces/:id/events returns empty list initially', async () => {
    const meta = await manager.createSpace('Kit', 'test-preset')
    const res = await app.request(`/spaces/${meta.id}/events`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
  })

  it('GET /spaces/:id/artifacts returns empty list initially', async () => {
    const meta = await manager.createSpace('Kit', 'test-preset')
    const res = await app.request(`/spaces/${meta.id}/artifacts`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.artifacts).toEqual([])
  })
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
cd /home/i/Code/MindKit
git add src/api/routes.ts src/space/space-manager.ts src/__tests__/routes-v2.test.ts
git commit -m "feat(server): 新增 PATCH spaces + topology/artifacts/events REST 端点"
```

---

## Task 6: WS 事件推送

在现有 WS 连接上复用 EventBus 推送 `space_event` 消息。

**Files:**
- Modify: `src/api/ws-handler.ts`

- [ ] **Step 1: 更新 WsOutMessage 类型**

```typescript
type WsOutMessage =
  | { type: 'chunk'; content: string }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'space_event'; event: SpaceEvent }  // 新增
```

- [ ] **Step 2: 在 handleWsConnection 中订阅 EventBus**

```typescript
export async function handleWsConnection(
  ws: WebSocket,
  spaceId: string,
  spaceManager: SpaceManager,
): Promise<void> {
  // ... 现有 meta/agent 获取逻辑不变

  // 订阅 EventBus，推送系统事件到 WS
  const bus = spaceManager.getEventBus(spaceId)
  const eventListener = (event: SpaceEvent) => {
    send(ws, { type: 'space_event', event })
  }
  bus.on(eventListener)

  // 断开时取消订阅
  ws.on('close', () => {
    bus.off(eventListener)
  })

  // ... 现有 message 处理逻辑不变
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
cd /home/i/Code/MindKit
git add src/api/ws-handler.ts
git commit -m "feat(server): WS 连接订阅 EventBus — 复用现有通道推送 space_event"
```

---

## Task 7: 全量 Typecheck + 测试 + 验证

最终集成验证。

**Files:** 无新文件

- [ ] **Step 1: Typecheck**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: 全量测试**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server test -- --run`
Expected: 全部 PASS

- [ ] **Step 3: 确认新端点数量**

快速 grep 确认新增端点：
```bash
grep -c 'app\.\(get\|post\|patch\|delete\)' src/api/routes.ts
```
Expected: 11 个端点（原 6 + 新 5：PATCH spaces, GET topology, GET artifacts, GET artifact detail, GET events）

- [ ] **Step 4: 提交（如有修复）**

如果前面步骤有 typecheck 或测试问题需要修复，此处统一提交修复。
