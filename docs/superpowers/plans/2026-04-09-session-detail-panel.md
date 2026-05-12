# Session Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session detail panel that displays L2 summaries, synthesis, and supports manual consolidation/integration triggers.

**Architecture:** Three new backend API endpoints (detail, consolidate, integrate) reading from StelloAgent's public `memory` and `sessions` properties. One new frontend overlay panel component rendered on top of TopologyCanvas, driven by node click events.

**Tech Stack:** Hono (server routes), React + Tailwind CSS + ReactMarkdown (frontend), Vitest (testing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/api/session-detail.ts` | Create | Three route handlers: detail, consolidate, integrate |
| `packages/server/src/api/routes.ts` | Modify | Register the three new routes |
| `packages/server/src/__tests__/session-detail.test.ts` | Create | Unit tests for the new handlers |
| `packages/web/src/lib/types.ts` | Modify | Add `SessionDetail` discriminated union type |
| `packages/web/src/lib/api.ts` | Modify | Add `fetchSessionDetail`, `triggerConsolidate`, `triggerIntegrate` |
| `packages/web/src/components/SessionDetailPanel.tsx` | Create | Overlay panel with child/main views |
| `packages/web/src/components/TopologyCanvas.tsx` | Modify | Add double-click for enter, single-click for detail |
| `packages/web/src/pages/KitWorkspace.tsx` | Modify | Wire up `detailSessionId` state and render panel |

---

### Task 1: Backend — Session Detail Handler

**Files:**
- Create: `packages/server/src/api/session-detail.ts`
- Create: `packages/server/src/__tests__/session-detail.test.ts`
- Modify: `packages/server/src/api/routes.ts`

**Context:**
- `StelloAgent` exposes `agent.memory` (MemoryEngine) and `agent.sessions` (SessionTree) as public readonly properties
- `agent.memory.readMemory(sid)` returns L2 (string | null), `agent.memory.readScope(sid)` returns insight (string | null)
- `agent.sessions.getRoot()` returns `{ id, label, ... }` — compare with `sid` to determine main vs child
- `agent.sessions.listAll()` returns `SessionMeta[]` for all sessions
- `agent.memory.readRecords(sid)` returns `TurnRecord[]` for consolidation input
- `agent.config.session?.consolidateFn` is the global consolidation function
- `agent.config.session?.mainSessionResolver` resolves the wrapped main session with `integrate()` method
- `agent.config.session?.integrateFn` is the integration function
- `agent.memory.writeMemory(sid, content)` persists L2
- Routes pattern: see `packages/server/src/api/routes.ts` — handlers receive Hono `Context`, use `spaceManager.getAgent(id, meta)` to get agent
- Test pattern: see `packages/server/src/__tests__/routes-v2.test.ts` — uses `app.request()` with Hono test helper

- [ ] **Step 1: Write failing tests for the detail endpoint**

Create `packages/server/src/__tests__/session-detail.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Hono } from 'hono'
import { SpaceManager } from '../space/space-manager'
import { buildRoutes } from '../api/routes'
import type { PresetConfig } from '../preset/preset-loader'

const TEST_PRESET: PresetConfig = {
  dirName: 'test-preset',
  name: 'Test',
  description: '',
  emoji: '🧠',
  color: '#6366f1',
  mode: 'AUTO',
  expectedArtifacts: '',
  systemPrompt: 'test prompt',
  forkProfiles: [],
  skills: [],
  llm: { model: 'test' },
  consolidatePrompt: null,
  integratePrompt: null,
}

describe('Session Detail API', () => {
  let spacesDir: string
  let manager: SpaceManager
  let app: ReturnType<typeof buildRoutes>

  beforeEach(async () => {
    spacesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-detail-'))
    manager = new SpaceManager({ spacesDir, presets: [TEST_PRESET], env: {} })
    app = buildRoutes(manager)
  })

  afterEach(async () => {
    await fs.rm(spacesDir, { recursive: true, force: true })
  })

  it('GET detail for main session returns type=main with synthesis and childL2s', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const agent = manager.getAgent(meta.id, meta)
    // Ensure root session exists
    const root = await agent.sessions.getRoot()

    const res = await app.request(`/spaces/${meta.id}/sessions/${root.id}/detail`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.type).toBe('main')
    expect(body).toHaveProperty('synthesis')
    expect(body).toHaveProperty('childL2s')
    expect(Array.isArray(body.childL2s)).toBe(true)
  })

  it('GET detail returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown/sessions/any/detail')
    expect(res.status).toBe(404)
  })

  it('POST consolidate returns 400 when no records exist', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const agent = manager.getAgent(meta.id, meta)
    const root = await agent.sessions.getRoot()

    const res = await app.request(`/spaces/${meta.id}/sessions/${root.id}/consolidate`, {
      method: 'POST',
    })
    // Should fail because there are no records to consolidate
    expect(res.status).toBe(400)
  })

  it('POST integrate returns 400 when not configured', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const res = await app.request(`/spaces/${meta.id}/integrate`, {
      method: 'POST',
    })
    // TEST_PRESET has no real LLM, so integration may fail or report not configured
    expect([200, 400, 500]).toContain(res.status)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/i/Code/MindKit && pnpm --filter server test -- --run session-detail`
Expected: FAIL — test file references routes that don't exist yet

- [ ] **Step 3: Create the session-detail handler**

Create `packages/server/src/api/session-detail.ts`:

```typescript
import type { Hono } from 'hono'
import type { SpaceManager } from '../space/space-manager'

/** 注册 session detail 相关路由 */
export function registerSessionDetailRoutes(app: Hono, spaceManager: SpaceManager): void {
  /** GET /spaces/:id/sessions/:sid/detail — 获取 session 的 L2/synthesis 详情 */
  app.get('/spaces/:id/sessions/:sid/detail', async (c) => {
    const id = c.req.param('id')
    const sid = c.req.param('sid')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)

    const agent = spaceManager.getAgent(id, meta)
    const root = await agent.sessions.getRoot()
    const isMain = root.id === sid

    if (isMain) {
      // Main Session: 返回 synthesis + 所有子节点 L2
      const synthesis = await agent.memory.readMemory(sid).catch(() => null)
      const allSessions = await agent.sessions.listAll()
      const childSessions = allSessions.filter((s) => s.id !== root.id)
      const childL2s = await Promise.all(
        childSessions.map(async (s) => ({
          sessionId: s.id,
          label: s.label,
          l2: await agent.memory.readMemory(s.id).catch(() => null),
        })),
      )
      return c.json({ type: 'main' as const, synthesis, childL2s })
    }

    // 子节点: 返回 L2 + insight
    const sessionMeta = await agent.sessions.get(sid)
    const label = sessionMeta?.label ?? sid
    const l2 = await agent.memory.readMemory(sid).catch(() => null)
    const insight = await agent.memory.readScope(sid).catch(() => null)
    return c.json({ type: 'child' as const, label, l2, insight })
  })

  /** POST /spaces/:id/sessions/:sid/consolidate — 手动触发 L3→L2 提炼 */
  app.post('/spaces/:id/sessions/:sid/consolidate', async (c) => {
    const id = c.req.param('id')
    const sid = c.req.param('sid')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)

    const agent = spaceManager.getAgent(id, meta)
    const consolidateFn = agent.config.session?.consolidateFn
    if (!consolidateFn) {
      return c.json({ error: 'No consolidateFn configured' }, 400)
    }

    const records = await agent.memory.readRecords(sid)
    if (records.length === 0) {
      return c.json({ error: 'No records to consolidate' }, 400)
    }

    const currentMemory = await agent.memory.readMemory(sid).catch(() => null)
    const messages = records.map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp }))
    const l2 = await consolidateFn(currentMemory, messages)
    await agent.memory.writeMemory(sid, l2)
    return c.json({ ok: true, l2 })
  })

  /** POST /spaces/:id/integrate — 手动触发 integration（synthesis + insights） */
  app.post('/spaces/:id/integrate', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)

    const agent = spaceManager.getAgent(id, meta)
    const mainSessionResolver = agent.config.session?.mainSessionResolver
    const integrateFn = agent.config.session?.integrateFn
    if (!mainSessionResolver || !integrateFn) {
      return c.json({ error: 'Integration not configured' }, 400)
    }

    try {
      const mainSession = await mainSessionResolver()
      await mainSession.integrate(integrateFn)
      // 读取刚生成的 synthesis
      const root = await agent.sessions.getRoot()
      const synthesis = await agent.memory.readMemory(root.id).catch(() => null)
      return c.json({ ok: true, synthesis })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 500)
    }
  })
}
```

- [ ] **Step 4: Register routes in routes.ts**

In `packages/server/src/api/routes.ts`, add import and call after existing routes:

```typescript
// At top, add import:
import { registerSessionDetailRoutes } from './session-detail'

// Before `return app`, add:
registerSessionDetailRoutes(app, spaceManager)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/i/Code/MindKit && pnpm --filter server test -- --run`
Expected: All tests PASS including the new session-detail tests

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/session-detail.ts packages/server/src/api/routes.ts packages/server/src/__tests__/session-detail.test.ts
git commit -m "feat(api): session detail/consolidate/integrate 端点"
```

---

### Task 2: Frontend — Types and API Functions

**Files:**
- Modify: `packages/web/src/lib/types.ts`
- Modify: `packages/web/src/lib/api.ts`

**Context:**
- `types.ts` contains all shared TypeScript interfaces (see current file for pattern)
- `api.ts` uses a generic `request<T>()` wrapper around fetch with `BASE = '/api'`
- The detail endpoint returns a discriminated union on `type: 'main' | 'child'`

- [ ] **Step 1: Add SessionDetail types to types.ts**

At the end of `packages/web/src/lib/types.ts`, before the last type definition, add:

```typescript
/** Session 详情 — 子节点 */
export interface SessionDetailChild {
  type: 'child'
  label: string
  l2: string | null
  insight: string | null
}

/** Session 详情 — Main Session */
export interface SessionDetailMain {
  type: 'main'
  synthesis: string | null
  childL2s: Array<{ sessionId: string; label: string; l2: string | null }>
}

/** Session 详情（discriminated union） */
export type SessionDetail = SessionDetailChild | SessionDetailMain
```

- [ ] **Step 2: Add API functions to api.ts**

At the end of `packages/web/src/lib/api.ts`, add:

```typescript
/* ── Session Detail ── */

export function fetchSessionDetail(
  spaceId: string,
  sessionId: string,
): Promise<SessionDetail> {
  return request(`/spaces/${spaceId}/sessions/${sessionId}/detail`)
}

export function triggerConsolidate(
  spaceId: string,
  sessionId: string,
): Promise<{ ok: true; l2: string }> {
  return request(`/spaces/${spaceId}/sessions/${sessionId}/consolidate`, { method: 'POST' })
}

export function triggerIntegrate(
  spaceId: string,
): Promise<{ ok: true; synthesis: string | null }> {
  return request(`/spaces/${spaceId}/integrate`, { method: 'POST' })
}
```

Don't forget to add `SessionDetail` to the import from `./types` at the top of `api.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/types.ts packages/web/src/lib/api.ts
git commit -m "feat(web): SessionDetail 类型和 API 函数"
```

---

### Task 3: Frontend — SessionDetailPanel Component

**Files:**
- Create: `packages/web/src/components/SessionDetailPanel.tsx`

**Context:**
- UI style: Follow `ChatPanel.tsx` patterns — Tailwind classes, `text-[13px]` body text, `text-text` / `text-text-muted` / `text-text-secondary` colors, `bg-card` / `bg-surface` backgrounds, `border-border` borders
- ChatPanel already imports `ReactMarkdown` with `remarkGfm` and `rehypeHighlight` — reuse the same markdown rendering
- Icons from `lucide-react`: `X`, `Loader2`, `RefreshCw`, `ChevronDown`, `ChevronRight`
- Panel is an overlay positioned absolutely over TopologyCanvas, right-aligned, ~360px wide
- Two views based on `SessionDetail.type`: child view and main view
- Loading, error, and triggering states

- [ ] **Step 1: Create SessionDetailPanel component**

Create `packages/web/src/components/SessionDetailPanel.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { fetchSessionDetail, triggerConsolidate, triggerIntegrate } from '@/lib/api'
import type { SessionDetail } from '@/lib/types'

interface SessionDetailPanelProps {
  spaceId: string
  sessionId: string
  onClose: () => void
}

/** Markdown 内容渲染 */
function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="prose-sm max-w-none text-text [&_p]:my-1 [&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:text-text [&_ul]:my-1 [&_ol]:my-1 [&_li]:text-[13px] [&_li]:text-text [&_strong]:text-text [&_strong]:font-semibold [&_code]:text-[11px] [&_code]:bg-surface [&_code]:text-primary-dark [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-[#2a2520] [&_pre]:text-[#e5e4e1] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-[11px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

/** L2 卡片（用于 Main Session 的各节点摘要列表） */
function L2Card({ label, l2 }: { label: string; l2: string | null }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border/40 rounded-lg bg-card/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-surface/50 transition-colors"
      >
        {expanded
          ? <ChevronDown size={12} className="text-text-muted shrink-0" />
          : <ChevronRight size={12} className="text-text-muted shrink-0" />}
        <span className="text-[12px] font-semibold text-text">{label}</span>
        {!l2 && <span className="text-[10px] text-text-muted ml-auto">暂无</span>}
      </button>
      {expanded && l2 && (
        <div className="border-t border-border/30 px-3 py-2">
          <MarkdownContent text={l2} />
        </div>
      )}
      {!expanded && l2 && (
        <div className="px-3 pb-2">
          <p className="text-[11px] text-text-secondary line-clamp-2">{l2}</p>
        </div>
      )}
    </div>
  )
}

/** Session 详情侧边面板 */
export function SessionDetailPanel({ spaceId, sessionId, onClose }: SessionDetailPanelProps) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSessionDetail(spaceId, sessionId)
      setDetail(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [spaceId, sessionId])

  useEffect(() => { loadDetail() }, [loadDetail])

  /** 手动触发 consolidate */
  const handleConsolidate = async () => {
    setTriggering(true)
    try {
      await triggerConsolidate(spaceId, sessionId)
      await loadDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提炼失败')
    } finally {
      setTriggering(false)
    }
  }

  /** 手动触发 integrate */
  const handleIntegrate = async () => {
    setTriggering(true)
    try {
      await triggerIntegrate(spaceId)
      await loadDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : '综合分析失败')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="absolute top-0 right-0 w-[360px] h-full bg-card/95 backdrop-blur-sm border-l border-border shadow-xl z-10 flex flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-border shrink-0">
        <span className="text-[13px] font-semibold text-text truncate">
          {detail?.type === 'main' ? 'Main Session' : detail?.type === 'child' ? detail.label : '详情'}
        </span>
        <button onClick={onClose} className="p-1 hover:bg-surface rounded transition-colors">
          <X size={14} className="text-text-muted" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="text-[12px] text-error bg-error/10 rounded-lg px-3 py-2">{error}</div>
        )}

        {!loading && detail?.type === 'child' && (
          <>
            {/* 摘要 */}
            <section>
              <h3 className="text-[11px] font-semibold text-text-muted tracking-wide mb-2">摘要</h3>
              {detail.l2 ? (
                <div className="bg-surface rounded-lg px-3 py-2 border border-border/30">
                  <MarkdownContent text={detail.l2} />
                </div>
              ) : (
                <p className="text-[12px] text-text-muted">暂无摘要（需要对话后触发提炼）</p>
              )}
            </section>

            {/* Insight */}
            {detail.insight && (
              <section>
                <h3 className="text-[11px] font-semibold text-text-muted tracking-wide mb-2">Insight</h3>
                <div className="bg-surface rounded-lg px-3 py-2 border border-border/30">
                  <MarkdownContent text={detail.insight} />
                </div>
              </section>
            )}

            {/* 操作按钮 */}
            <button
              onClick={handleConsolidate}
              disabled={triggering}
              className="flex items-center gap-2 text-[12px] text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
            >
              {triggering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              立即提炼
            </button>
          </>
        )}

        {!loading && detail?.type === 'main' && (
          <>
            {/* 综合分析 */}
            <section>
              <h3 className="text-[11px] font-semibold text-text-muted tracking-wide mb-2">综合分析</h3>
              {detail.synthesis ? (
                <div className="bg-surface rounded-lg px-3 py-2 border border-border/30">
                  <MarkdownContent text={detail.synthesis} />
                </div>
              ) : (
                <p className="text-[12px] text-text-muted">暂无综合分析（需要子节点提炼后触发综合）</p>
              )}
            </section>

            {/* 操作按钮 */}
            <button
              onClick={handleIntegrate}
              disabled={triggering}
              className="flex items-center gap-2 text-[12px] text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
            >
              {triggering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              立即综合
            </button>

            {/* 各节点摘要 */}
            <section>
              <h3 className="text-[11px] font-semibold text-text-muted tracking-wide mb-2">
                各节点摘要 ({detail.childL2s.length})
              </h3>
              <div className="space-y-2">
                {detail.childL2s.length === 0 && (
                  <p className="text-[12px] text-text-muted">暂无子节点</p>
                )}
                {detail.childL2s.map((child) => (
                  <L2Card key={child.sessionId} label={child.label} l2={child.l2} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/SessionDetailPanel.tsx
git commit -m "feat(web): SessionDetailPanel 组件"
```

---

### Task 4: Frontend — TopologyCanvas Click Behavior

**Files:**
- Modify: `packages/web/src/components/TopologyCanvas.tsx`

**Context:**
- Currently `TopologyCanvas` has `onNodeSelect: (nodeId: string) => void` callback fired on single click (mouseUp without drag) at line 324
- We need to add `onNodeDetail?: (nodeId: string) => void` callback for single-click (open detail panel)
- The existing `onNodeSelect` stays for selecting the active session (ChatPanel)
- Single click → fires BOTH `onNodeSelect` (select for chat) AND `onNodeDetail` (open detail panel)
- Double click → enters session (existing behavior, but currently there's no explicit double-click; enter is done implicitly by selecting)

Since single-click currently does session selection (which drives ChatPanel), and we want it to ALSO open the detail panel, the simplest approach is:
- Add `onNodeDetail` prop
- Fire it alongside `onNodeSelect` in the existing mouseUp handler

- [ ] **Step 1: Add onNodeDetail prop to TopologyCanvas**

In `packages/web/src/components/TopologyCanvas.tsx`:

Update the `TopologyCanvasProps` interface (around line 196-200):
```typescript
interface TopologyCanvasProps {
  nodes: TopoNode[]
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string) => void
  onNodeDetail?: (nodeId: string) => void
}
```

Update the component signature (around line 203):
```typescript
export function TopologyCanvas({ nodes, selectedNodeId, onNodeSelect, onNodeDetail }: TopologyCanvasProps) {
```

Update the mouseUp handler (around line 324) — after `if (node) onNodeSelect(node.id)`, add:
```typescript
if (node) {
  onNodeSelect(node.id)
  onNodeDetail?.(node.id)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/TopologyCanvas.tsx
git commit -m "feat(web): TopologyCanvas 支持 onNodeDetail 回调"
```

---

### Task 5: Frontend — Wire Up KitWorkspace

**Files:**
- Modify: `packages/web/src/pages/KitWorkspace.tsx`

**Context:**
- `KitWorkspace` currently manages `selectedNodeId` state which drives the ChatPanel's active session
- We add a `detailSessionId` state (string | null) to control the detail panel visibility
- When a node is clicked on TopologyCanvas, both `selectedNodeId` and `detailSessionId` are set
- The SessionDetailPanel renders as an overlay inside the right-side topology container
- Clicking the close button on the panel clears `detailSessionId`

- [ ] **Step 1: Add imports and state**

In `packages/web/src/pages/KitWorkspace.tsx`:

Add to imports:
```typescript
import { SessionDetailPanel } from '@/components/SessionDetailPanel'
```

Add state after `selectedNodeId`:
```typescript
const [detailSessionId, setDetailSessionId] = useState<string | null>(null)
```

- [ ] **Step 2: Pass onNodeDetail to TopologyCanvas**

Update the TopologyCanvas JSX (around line 171-177):

```tsx
<div className="w-1/2 relative">
  <TopologyCanvas
    nodes={nodes}
    selectedNodeId={selectedNodeId}
    onNodeSelect={setSelectedNodeId}
    onNodeDetail={setDetailSessionId}
  />
  {detailSessionId && spaceId && (
    <SessionDetailPanel
      spaceId={spaceId}
      sessionId={detailSessionId}
      onClose={() => setDetailSessionId(null)}
    />
  )}
</div>
```

Note: The outer div changes from `className="w-1/2"` to `className="w-1/2 relative"` so the absolute-positioned panel overlays correctly.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/KitWorkspace.tsx
git commit -m "feat(web): KitWorkspace 集成 SessionDetailPanel"
```

---

### Task 6: Integration Test and Final Verification

**Files:**
- All files from Tasks 1-5

- [ ] **Step 1: Run all backend tests**

Run: `cd /home/i/Code/MindKit && pnpm --filter server test -- --run`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `cd /home/i/Code/MindKit && pnpm --filter web tsc --noEmit && pnpm --filter server tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Start dev server and manually verify**

Run: `cd /home/i/Code/MindKit && pnpm dev`

Manual verification:
1. Navigate to a space
2. Single-click a topology node → detail panel appears on right overlay
3. Panel shows "摘要" section (likely empty for new spaces)
4. Click Main node → panel shows "综合分析" and "各节点摘要" sections
5. Click ✕ → panel closes
6. Click "立即提炼" button → triggers consolidation (requires prior conversation)
7. Click "立即综合" button → triggers integration

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(web): session detail panel 调整"
```
