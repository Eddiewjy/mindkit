# 前端接入真实后端 + Session 分裂跑通 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端从 localStorage 切换到真实后端 API，丰富创建 Kit 配置，跑通 session 分裂 e2e

**Architecture:** 后端补两个点（session records 端点 + EventBus 接入 Engine hooks + POST /spaces 传 options），前端删除全局 store，新建 api.ts 封装后端调用，各页面组件自行管理数据。对话走同步 REST POST（仿 devtools），WS 只推系统事件。

**Tech Stack:** TypeScript · Hono · React · Vite (proxy already configured) · @stello-ai/core

**Spec:** `docs/superpowers/specs/2026-04-08-frontend-backend-integration-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `server/src/api/routes.ts` | Modify | 新增 GET sessions/:sid/records 端点 + POST /spaces 传 options |
| `server/src/space/space-factory.ts` | Modify | Engine hooks 接入 EventBus |
| `server/src/space/space-manager.ts` | Modify | createSpaceAgent 传 EventBus |
| `web/src/lib/api.ts` | Create | 后端 API 客户端 |
| `web/src/lib/store.tsx` | Delete | 删除 localStorage store |
| `web/src/lib/types.ts` | Modify | 对齐后端类型 |
| `web/src/App.tsx` | Modify | 删除 StoreProvider 包裹 |
| `web/src/pages/SpaceList.tsx` | Modify | 接入真实 API |
| `web/src/pages/KitWorkspace.tsx` | Modify | 接入 topology API + WS |
| `web/src/components/ChatPanel.tsx` | Modify | 接入 REST chat + records |

---

## Task 1: 后端 — Session Records 端点 + POST /spaces options 透传

**Files:**
- Modify: `packages/server/src/api/routes.ts`

- [ ] **Step 1: 新增 GET /spaces/:id/sessions/:sid/records 端点**

在 routes.ts 的 events 端点后、return 之前添加：

```typescript
/** GET /spaces/:id/sessions/:sid/records — 获取 session 对话记录 */
app.get('/spaces/:id/sessions/:sid/records', async (c) => {
  const id = c.req.param('id')
  const sid = c.req.param('sid')
  const meta = await spaceManager.getSpace(id)
  if (!meta) return c.json({ error: 'Space not found' }, 404)
  const agent = spaceManager.getAgent(id, meta)
  try {
    const records = await agent.memory.readRecords(sid)
    return c.json({
      records: records
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp })),
    })
  } catch {
    return c.json({ records: [] })
  }
})
```

- [ ] **Step 2: 更新 POST /spaces 端点透传 options**

修改 POST /spaces 端点，将 body 中的扩展字段传给 createSpace：

```typescript
app.post('/spaces', async (c) => {
  const body = await c.req.json<{
    name?: string
    presetDirName?: string
    emoji?: string
    color?: string
    description?: string
    mode?: 'AUTO' | 'PRO'
    expectedArtifacts?: string
    presetSessions?: SpaceMeta['presetSessions']
    skills?: SpaceMeta['skills']
  }>()
  if (!body.name || !body.presetDirName) {
    return c.json({ error: 'name and presetDirName are required' }, 400)
  }
  try {
    const { name, presetDirName, ...options } = body
    const meta = await spaceManager.createSpace(name, presetDirName, options)
    return c.json(meta, 201)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 400)
  }
})
```

需要在 import 行添加 `SpaceMeta`（已有 `SpaceUpdatePatch`，加上 `SpaceMeta`）。

- [ ] **Step 3: Typecheck + 全量测试**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec tsc --noEmit && pnpm --filter @mindkit/server test -- --run`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/api/routes.ts
git commit -m "feat(server): 新增 session records 端点 + POST /spaces 透传 options"
```

---

## Task 2: 后端 — EventBus 接入 Engine Hooks

SpaceFactory 创建 Agent 时，通过 Engine hooks 将 fork 事件写入 EventBus。

**Files:**
- Modify: `packages/server/src/space/space-factory.ts`
- Modify: `packages/server/src/space/space-manager.ts`

- [ ] **Step 1: SpaceFactoryContext 新增 eventBus 字段**

在 `space-factory.ts` 的 `SpaceFactoryContext` 中添加：

```typescript
import type { EventBus } from '../events/event-bus'

export interface SpaceFactoryContext {
  dataDir: string
  config: PresetConfig
  env: Record<string, string | undefined>
  spaceMeta?: SpaceMeta
  eventBus?: EventBus  // 新增
}
```

- [ ] **Step 2: 在 createSpaceAgent 中接入 hooks**

在 `orchestration.hooks` 中添加 `onSessionFork` hook。找到现有的 `hooks: { onRoundEnd(...) { ... } }` 块，扩展为：

```typescript
hooks: {
  onRoundEnd({ sessionId, input, turn }) {
    // ... 现有逻辑不变
  },
  onSessionFork({ parentId, child }) {
    if (ctx.eventBus) {
      ctx.eventBus.emit({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        kind: 'node_forked',
        payload: { nodeId: child.id, label: child.label, parentId },
      })
    }
  },
},
```

需要在文件顶部添加 `import * as crypto from 'node:crypto'`（如果尚未导入）。

- [ ] **Step 3: SpaceManager.getAgent 传入 eventBus**

在 `space-manager.ts` 的 `getAgent` 方法中，传入 eventBus：

```typescript
const agent = createSpaceAgent({
  dataDir: path.join(this.spacesDir, id),
  config: preset,
  env: this.env,
  spaceMeta: meta,
  eventBus: this.getEventBus(id),  // 新增
})
```

- [ ] **Step 4: Typecheck + 全量测试**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec tsc --noEmit && pnpm --filter @mindkit/server test -- --run`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/space/space-factory.ts packages/server/src/space/space-manager.ts
git commit -m "feat(server): EventBus 接入 Engine hooks — onSessionFork 推送 node_forked 事件"
```

---

## Task 3: 前端 — API 客户端 + 删除 Store

**Files:**
- Create: `packages/web/src/lib/api.ts`
- Delete: `packages/web/src/lib/store.tsx`
- Modify: `packages/web/src/lib/types.ts`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: 重写 types.ts 对齐后端**

```typescript
// packages/web/src/lib/types.ts

/** Space 元数据（对应后端 SpaceMeta） */
export interface SpaceMeta {
  id: string
  name: string
  presetDirName: string
  createdAt: string
  emoji: string
  color: string
  description?: string
  mode: 'AUTO' | 'PRO'
  expectedArtifacts?: string
}

/** Preset 摘要 */
export interface PresetSummary {
  dirName: string
  name: string
  description: string
}

/** 递归拓扑树节点（core SessionTreeNode） */
export interface SessionTreeNode {
  id: string
  label: string
  sourceSessionId?: string
  status: 'active' | 'archived'
  turnCount: number
  children: SessionTreeNode[]
}

/** 对话记录 */
export interface ChatRecord {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

/** WS 服务端消息 */
export type WsMessage =
  | { type: 'chunk'; content: string }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'space_event'; event: SpaceEvent }

/** 系统事件 */
export interface SpaceEvent {
  id: string
  at: string
  kind: string
  payload: Record<string, unknown>
}
```

- [ ] **Step 2: 创建 api.ts**

```typescript
// packages/web/src/lib/api.ts
import type { SpaceMeta, PresetSummary, SessionTreeNode, ChatRecord, SpaceEvent } from './types'

const BASE = '/api'

/** 通用 fetch 封装 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

/* ── Presets ── */

export function fetchPresets(): Promise<PresetSummary[]> {
  return request('/presets')
}

/* ── Spaces ── */

export function fetchSpaces(): Promise<SpaceMeta[]> {
  return request('/spaces')
}

export function createSpace(body: {
  name: string
  presetDirName: string
  emoji?: string
  color?: string
  description?: string
  mode?: 'AUTO' | 'PRO'
  expectedArtifacts?: string
  [key: string]: unknown
}): Promise<SpaceMeta> {
  return request('/spaces', { method: 'POST', body: JSON.stringify(body) })
}

export function deleteSpace(id: string): Promise<void> {
  return request(`/spaces/${id}`, { method: 'DELETE' })
}

/* ── Topology ── */

export function fetchTopology(spaceId: string): Promise<SessionTreeNode> {
  return request(`/spaces/${spaceId}/topology`)
}

/* ── Chat ── */

export function sendTurn(
  spaceId: string,
  sessionId: string,
  message: string,
): Promise<{ content: string; sessionId: string }> {
  return request(`/spaces/${spaceId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, message }),
  })
}

/* ── Session Records ── */

export function fetchRecords(
  spaceId: string,
  sessionId: string,
): Promise<{ records: ChatRecord[] }> {
  return request(`/spaces/${spaceId}/sessions/${sessionId}/records`)
}

/* ── Events ── */

export function fetchEvents(
  spaceId: string,
  limit = 100,
): Promise<{ events: SpaceEvent[] }> {
  return request(`/spaces/${spaceId}/events?limit=${limit}`)
}
```

- [ ] **Step 3: 删除 store.tsx，更新 App.tsx**

删除 `packages/web/src/lib/store.tsx`。

更新 `App.tsx`，删除 StoreProvider：

```typescript
// packages/web/src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { SpaceList } from '@/pages/SpaceList'
import { KitWorkspace } from '@/pages/KitWorkspace'

/** 主应用 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<SpaceList />} />
      <Route path="/kit/:id" element={<KitWorkspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

- [ ] **Step 4: 确认 web typecheck**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/web exec tsc --noEmit`
Expected: 会有 SpaceList/KitWorkspace/ChatPanel 的引用错误（它们还引用旧 store）——这是预期的，后续 task 修复。

- [ ] **Step 5: 提交**

```bash
cd /home/i/Code/MindKit
git add packages/web/src/lib/api.ts packages/web/src/lib/types.ts packages/web/src/App.tsx
git rm packages/web/src/lib/store.tsx
git commit -m "feat(web): 新建 API 客户端 + 删除 localStorage store"
```

---

## Task 4: 前端 — SpaceList 接入真实 API

**Files:**
- Modify: `packages/web/src/pages/SpaceList.tsx`

- [ ] **Step 1: 重写 SpaceList**

完整重写，从后端拉数据，创建 Kit 时传完整 options（含 preset 选择 + JSON 高级配置）：

```typescript
// packages/web/src/pages/SpaceList.tsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchSpaces, fetchPresets, createSpace, deleteSpace } from '@/lib/api'
import type { SpaceMeta, PresetSummary } from '@/lib/types'

/** 创建 Kit 弹窗 */
function CreateKitModal({
  presets,
  onClose,
  onCreated,
}: {
  presets: PresetSummary[]
  onClose: () => void
  onCreated: (meta: SpaceMeta) => void
}) {
  const [name, setName] = useState('')
  const [presetDirName, setPresetDirName] = useState(presets[0]?.dirName ?? '')
  const [mode, setMode] = useState<'AUTO' | 'PRO'>('AUTO')
  const [advancedJson, setAdvancedJson] = useState('{}')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !presetDirName) return
    setLoading(true)
    setError('')
    try {
      let extra: Record<string, unknown> = {}
      try { extra = JSON.parse(advancedJson) } catch { setError('JSON 格式错误'); setLoading(false); return }
      const meta = await createSpace({ name: name.trim(), presetDirName, mode, ...extra })
      onCreated(meta)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-2xl p-6 w-[480px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">创建新空间</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Preset *</label>
            <select
              value={presetDirName}
              onChange={(e) => setPresetDirName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text"
            >
              {presets.map((p) => (
                <option key={p.dirName} value={p.dirName}>{p.name} — {p.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">空间名称 *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="如：黑客松项目规划"
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">空间模式</label>
            <div className="flex gap-2">
              {(['AUTO', 'PRO'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={cn(
                    'flex-1 py-2 rounded-lg border text-sm font-medium transition-colors',
                    mode === m ? 'border-primary bg-primary-light text-primary' : 'border-border bg-surface text-text-secondary hover:bg-muted',
                  )}
                >
                  {m}
                  <span className="block text-xs font-normal mt-0.5 text-text-muted">
                    {m === 'AUTO' ? 'AI 自动分裂' : 'AI 判断 + 用户确认'}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">高级配置 (JSON)</label>
            <textarea
              value={advancedJson} onChange={(e) => setAdvancedJson(e.target.value)}
              rows={4} placeholder='{"emoji": "🚀", "description": "...", "expectedArtifacts": "..."}'
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text font-mono text-xs placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-muted transition-colors">取消</button>
          <button onClick={handleCreate} disabled={!name.trim() || !presetDirName || loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-40"
          >
            {loading ? '创建中...' : '创建空间'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Kit Space 列表页 */
export function SpaceList() {
  const navigate = useNavigate()
  const [spaces, setSpaces] = useState<SpaceMeta[]>([])
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    fetchSpaces().then(setSpaces).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    fetchPresets().then(setPresets)
  }, [refresh])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除「${name}」？`)) return
    await deleteSpace(id)
    refresh()
  }

  return (
    <div className="min-h-screen bg-bg p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Space</h1>
            <p className="text-text-muted text-sm mt-1">你的 AI 认知空间集合</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            <Plus size={16} /> 创建新空间
          </button>
        </div>

        {loading ? (
          <div className="text-center text-text-muted py-20">加载中...</div>
        ) : spaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <GitBranch size={48} className="mb-4 opacity-30" />
            <p className="text-lg mb-2">还没有任何空间</p>
            <button onClick={() => setShowCreate(true)} className="text-primary hover:underline text-sm">
              创建你的第一个 Kit
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {spaces.map((s) => (
              <div key={s.id} onClick={() => navigate(`/kit/${s.id}`)}
                className="bg-card rounded-xl border border-border p-5 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
                      {s.emoji} {s.name}
                    </h3>
                    {s.description && <p className="text-sm text-text-muted mt-1 line-clamp-2">{s.description}</p>}
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary-light text-primary font-medium shrink-0 ml-2">
                    {s.mode}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
                  <span>{new Date(s.createdAt).toLocaleDateString('zh-CN')}</span>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id, s.name) }}
                    className="ml-auto text-text-muted hover:text-error transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div onClick={() => setShowCreate(true)}
              className="border-2 border-dashed border-border rounded-xl p-5 flex items-center justify-center cursor-pointer hover:border-primary/40 hover:bg-primary-light/30 transition-all min-h-[120px]"
            >
              <span className="text-text-muted flex items-center gap-2"><Plus size={18} /> 创建新空间</span>
            </div>
          </div>
        )}
      </div>

      {showCreate && presets.length > 0 && (
        <CreateKitModal
          presets={presets}
          onClose={() => setShowCreate(false)}
          onCreated={(meta) => navigate(`/kit/${meta.id}`)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 确认无语法错误**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/web exec tsc --noEmit 2>&1 | head -20`
Expected: SpaceList 本身不应有错误（可能 KitWorkspace/ChatPanel 还有旧引用错误，属预期）

- [ ] **Step 3: 提交**

```bash
cd /home/i/Code/MindKit
git add packages/web/src/pages/SpaceList.tsx
git commit -m "feat(web): SpaceList 接入真实 API — preset 选择 + 高级 JSON 配置"
```

---

## Task 5: 前端 — KitWorkspace 接入 topology + WS

**Files:**
- Modify: `packages/web/src/pages/KitWorkspace.tsx`

- [ ] **Step 1: 重写 KitWorkspace**

从后端拉 topology 树，建立 WS 连接监听事件，管理 selectedSessionId：

```typescript
// packages/web/src/pages/KitWorkspace.tsx
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { fetchTopology } from '@/lib/api'
import { ChatPanel } from '@/components/ChatPanel'
import { TopologyCanvas } from '@/components/TopologyCanvas'
import type { SessionTreeNode, WsMessage, SpaceMeta } from '@/lib/types'

/** 递归展平树为 TopoNode[] 供 TopologyCanvas 使用 */
interface FlatNode {
  id: string
  label: string
  parentId: string | null
  status: 'active' | 'archived'
  turns: number
  children: string[]
}

function flattenTree(node: SessionTreeNode, parentId: string | null = null): FlatNode[] {
  const flat: FlatNode = {
    id: node.id,
    label: node.label,
    parentId,
    status: node.status,
    turns: node.turnCount,
    children: node.children.map((c) => c.id),
  }
  return [flat, ...node.children.flatMap((c) => flattenTree(c, node.id))]
}

/** Kit 工作界面 — 左侧对话 + 右侧拓扑图 */
export function KitWorkspace() {
  const { id: spaceId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [tree, setTree] = useState<SessionTreeNode | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [spaceName, setSpaceName] = useState('')
  const [loading, setLoading] = useState(true)

  /** 拉取拓扑树 */
  const refreshTopology = useCallback(async () => {
    if (!spaceId) return
    try {
      const t = await fetchTopology(spaceId)
      setTree(t)
      // 首次加载默认选中根节点
      setSelectedSessionId((prev) => prev ?? t.id)
    } catch {
      // space 可能尚未初始化
    } finally {
      setLoading(false)
    }
  }, [spaceId])

  /** 初始化加载 + 拉 space 名称 */
  useEffect(() => {
    if (!spaceId) return
    refreshTopology()
    // 拉 space meta 获取名称
    fetch(`/api/spaces/${spaceId}`).then((r) => r.json()).then((meta: SpaceMeta) => {
      setSpaceName(`${meta.emoji} ${meta.name}`)
    }).catch(() => {})
  }, [spaceId, refreshTopology])

  /** WS 连接，监听 space_event */
  useEffect(() => {
    if (!spaceId) return
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws/spaces/${spaceId}`)
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage
        if (msg.type === 'space_event' && msg.event.kind === 'node_forked') {
          // fork 事件 → 刷新拓扑
          refreshTopology()
        }
      } catch { /* ignore */ }
    }
    return () => { ws.close() }
  }, [spaceId, refreshTopology])

  const nodes = useMemo(() => (tree ? flattenTree(tree) : []), [tree])

  if (!spaceId) return null

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* 顶栏 */}
      <div className="h-12 px-4 flex items-center border-b border-border bg-card shrink-0">
        <button onClick={() => navigate('/')}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text transition-colors mr-4"
        >
          <ArrowLeft size={16} /> 返回 Space
        </button>
        <h2 className="font-semibold text-sm">{spaceName || 'Loading...'}</h2>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：对话面板 */}
        <div className="w-1/2 border-r border-border">
          {loading ? (
            <div className="flex items-center justify-center h-full text-text-muted">加载中...</div>
          ) : (
            <ChatPanel
              spaceId={spaceId}
              sessionId={selectedSessionId}
              sessionLabel={nodes.find((n) => n.id === selectedSessionId)?.label ?? ''}
            />
          )}
        </div>

        {/* 右侧：拓扑图 */}
        <div className="w-1/2">
          <TopologyCanvas
            nodes={nodes}
            selectedNodeId={selectedSessionId}
            onNodeSelect={setSelectedSessionId}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
cd /home/i/Code/MindKit
git add packages/web/src/pages/KitWorkspace.tsx
git commit -m "feat(web): KitWorkspace 接入 topology API + WS 事件监听"
```

---

## Task 6: 前端 — ChatPanel 接入 REST chat + records

**Files:**
- Modify: `packages/web/src/components/ChatPanel.tsx`

- [ ] **Step 1: 重写 ChatPanel**

接入 `sendTurn` 和 `fetchRecords`，删除所有 store 引用：

```typescript
// packages/web/src/components/ChatPanel.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, User, Bot, Loader2 } from 'lucide-react'
import { sendTurn, fetchRecords } from '@/lib/api'
import type { ChatRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ChatPanelProps {
  spaceId: string
  sessionId: string | null
  sessionLabel: string
}

/** 对话面板 */
export function ChatPanel({ spaceId, sessionId, sessionLabel }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatRecord[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  /** 切换 session 时拉取历史 */
  const loadHistory = useCallback(async () => {
    if (!sessionId) { setMessages([]); return }
    setFetching(true)
    try {
      const { records } = await fetchRecords(spaceId, sessionId)
      setMessages(records)
    } catch {
      setMessages([])
    } finally {
      setFetching(false)
    }
  }, [spaceId, sessionId])

  useEffect(() => { loadHistory() }, [loadHistory])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = async () => {
    if (!input.trim() || !sessionId || loading) return
    const userMsg: ChatRecord = { role: 'user', content: input.trim(), timestamp: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    try {
      const res = await sendTurn(spaceId, sessionId, userMsg.content)
      const assistantMsg: ChatRecord = { role: 'assistant', content: res.content, timestamp: new Date().toISOString() }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: ChatRecord = { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date().toISOString() }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 节点标题 */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        {sessionId ? (
          <div>
            <h3 className="font-medium text-sm">{sessionLabel || sessionId}</h3>
            <p className="text-xs text-text-muted mt-0.5">{messages.length} 条消息</p>
          </div>
        ) : (
          <p className="text-sm text-text-muted">选择一个节点开始对话</p>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {fetching && (
          <div className="text-center text-text-muted text-sm py-8">
            <Loader2 size={16} className="animate-spin inline mr-2" />加载对话历史...
          </div>
        )}
        {!fetching && messages.length === 0 && sessionId && (
          <div className="text-center text-text-muted text-sm py-8">在下方输入消息开始对话</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={14} className="text-primary" />
              </div>
            )}
            <div className={cn(
              'max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap',
              msg.role === 'user' ? 'bg-primary text-white rounded-br-sm' : 'bg-surface text-text rounded-bl-sm',
            )}>
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <User size={14} className="text-text-muted" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={14} className="text-primary" />
            </div>
            <div className="px-3 py-2 rounded-lg bg-surface text-text-muted text-sm rounded-bl-sm">
              <Loader2 size={14} className="animate-spin inline mr-1" /> 思考中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <div className="flex gap-2">
          <input
            type="text" value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={sessionId ? '输入消息...' : '请先选择节点'}
            disabled={!sessionId || loading}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={!input.trim() || !sessionId || loading}
            className="px-3 py-2 rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
cd /home/i/Code/MindKit
git add packages/web/src/components/ChatPanel.tsx
git commit -m "feat(web): ChatPanel 接入 REST chat + session records"
```

---

## Task 7: 全量验证 — Typecheck + 构建 + 手动 E2E

**Files:** 无新文件

- [ ] **Step 1: 后端 typecheck + 测试**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec tsc --noEmit && pnpm --filter @mindkit/server test -- --run`
Expected: 通过

- [ ] **Step 2: 前端 typecheck**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/web exec tsc --noEmit`
Expected: 通过（TopologyCanvas 的 props 接口可能需要微调，因为 TopoNode 类型变了）

- [ ] **Step 3: 前端构建**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/web build`
Expected: 构建成功

- [ ] **Step 4: 修复任何 typecheck / 构建错误**

如果 TopologyCanvas 因 props 类型变化而报错，调整其 props 接口接受新的 `FlatNode` 类型。最小化修改——TopologyCanvas 内部渲染逻辑不需要变，只需 props 类型兼容。

- [ ] **Step 5: 提交修复（如有）**

```bash
cd /home/i/Code/MindKit
git add -A
git commit -m "fix(web): 修复 typecheck 和构建错误"
```
