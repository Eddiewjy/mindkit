# Preset Node Light-up Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preset forkProfile nodes appear as gray unconnected stars in the topology canvas, and "light up" when AI creates a matching session.

**Architecture:** Pure MindKit implementation — no Stello core changes. Server tracks profile→session mapping via a `TrackingProfileRegistry` wrapper and callback injection. Frontend merges virtual inactive nodes into the topology via `useMemo`. TopologyCanvas renders inactive nodes with distinct gray/dashed style and animates activation transitions.

**Tech Stack:** TypeScript, React, HTML5 Canvas, Vitest, Hono (server)

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `packages/server/src/space/tracking-profile-registry.ts` | Wraps `ForkProfileRegistryImpl` to capture last-resolved profile name | **Create** |
| `packages/server/src/space/space-manager.ts` | Add `activatedPresets` to `SpaceMeta` + `recordPresetActivation()` | **Modify** |
| `packages/server/src/space/space-factory.ts` | Use `TrackingProfileRegistry`, fire callback on preset activation, augment WS payload | **Modify** |
| `packages/web/src/lib/types.ts` | Add `activatedPresets` to `SpaceMeta`, add `'inactive'` to `TopoNode.status`, add `presetName` | **Modify** |
| `packages/web/src/pages/KitWorkspace.tsx` | `activatedPresets` state, `useMemo` merge logic, WS handler update | **Modify** |
| `packages/web/src/components/TopologyCanvas.tsx` | Inactive node layout/rendering, activation animation | **Modify** |
| `packages/web/src/pages/SpaceList.tsx` | Progress badge on Kit cards | **Modify** |
| `packages/server/src/__tests__/tracking-profile-registry.test.ts` | Unit tests for tracking wrapper | **Create** |
| `packages/server/src/__tests__/space-manager.test.ts` | Add tests for `recordPresetActivation` | **Modify** |

---

### Task 1: TrackingProfileRegistry

**Files:**
- Create: `packages/server/src/space/tracking-profile-registry.ts`
- Create: `packages/server/src/__tests__/tracking-profile-registry.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// packages/server/src/__tests__/tracking-profile-registry.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/i/Code/MindKit && pnpm vitest run packages/server/src/__tests__/tracking-profile-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TrackingProfileRegistry**

```typescript
// packages/server/src/space/tracking-profile-registry.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/i/Code/MindKit && pnpm vitest run packages/server/src/__tests__/tracking-profile-registry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/space/tracking-profile-registry.ts packages/server/src/__tests__/tracking-profile-registry.test.ts
git commit -m "feat(server): TrackingProfileRegistry 追踪 profile 使用"
```

---

### Task 2: SpaceManager — activatedPresets persistence

**Files:**
- Modify: `packages/server/src/space/space-manager.ts`
- Modify: `packages/server/src/__tests__/space-manager.test.ts`

- [ ] **Step 1: Write tests**

Add to `packages/server/src/__tests__/space-manager.test.ts` inside the existing `describe('SpaceManager', ...)`:

```typescript
describe('recordPresetActivation', () => {
  it('records profileName → sessionId mapping in meta', async () => {
    const meta = await manager.createSpace({ name: 'Test', presetDirName: 'test-preset' })
    await manager.recordPresetActivation(meta.id, 'idea-deep-dive', 'session-123')

    const updated = await manager.getSpace(meta.id)
    expect(updated!.activatedPresets).toEqual({ 'idea-deep-dive': 'session-123' })
  })

  it('preserves existing activations when adding new ones', async () => {
    const meta = await manager.createSpace({ name: 'Test', presetDirName: 'test-preset' })
    await manager.recordPresetActivation(meta.id, 'a', 'session-1')
    await manager.recordPresetActivation(meta.id, 'b', 'session-2')

    const updated = await manager.getSpace(meta.id)
    expect(updated!.activatedPresets).toEqual({ a: 'session-1', b: 'session-2' })
  })

  it('does nothing if space does not exist', async () => {
    // Should not throw
    await manager.recordPresetActivation('nonexistent', 'a', 'session-1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/i/Code/MindKit && pnpm vitest run packages/server/src/__tests__/space-manager.test.ts`
Expected: FAIL — `recordPresetActivation` does not exist

- [ ] **Step 3: Add `activatedPresets` to SpaceMeta and implement `recordPresetActivation`**

In `packages/server/src/space/space-manager.ts`:

1. Add to `SpaceMeta` interface (after `skills?: SpaceSkill[]`):
```typescript
/** preset 激活映射：profileName → sessionId */
activatedPresets?: Record<string, string>
```

2. Add method to `SpaceManager` class (after `getArtifactStore`):
```typescript
/** 记录 preset 被激活（内部方法，不暴露为 API） */
async recordPresetActivation(spaceId: string, profileName: string, sessionId: string): Promise<void> {
  const meta = await this.readMeta(spaceId).catch(() => null)
  if (!meta) return

  const activated = meta.activatedPresets ?? {}
  activated[profileName] = sessionId
  meta.activatedPresets = activated

  const metaPath = path.join(this.spacesDir, spaceId, 'meta.json')
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/i/Code/MindKit && pnpm vitest run packages/server/src/__tests__/space-manager.test.ts`
Expected: PASS (all existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/space/space-manager.ts packages/server/src/__tests__/space-manager.test.ts
git commit -m "feat(server): SpaceMeta.activatedPresets + recordPresetActivation"
```

---

### Task 3: space-factory — callback injection + WS payload

**Files:**
- Modify: `packages/server/src/space/space-factory.ts`
- Modify: `packages/server/src/space/space-manager.ts` (getAgent call site)

- [ ] **Step 1: Add `onPresetActivated` to `SpaceFactoryContext`**

In `packages/server/src/space/space-factory.ts`, add to the `SpaceFactoryContext` interface:

```typescript
/** preset 被激活时的回调（由 SpaceManager 提供） */
onPresetActivated?: (profileName: string, sessionId: string) => void
```

- [ ] **Step 2: Replace `ForkProfileRegistryImpl` with `TrackingProfileRegistry`**

In `packages/server/src/space/space-factory.ts`:

1. Update imports — replace `ForkProfileRegistryImpl` with `TrackingProfileRegistry`:
```typescript
import { TrackingProfileRegistry } from './tracking-profile-registry'
```
Remove `ForkProfileRegistryImpl` from the `@stello-ai/core` import line.

2. Replace line `const profiles = new ForkProfileRegistryImpl()` with:
```typescript
const profiles = new TrackingProfileRegistry()
```

3. Build preset names set (after profile registration loop, before `config` object):
```typescript
const presetNames = new Set([
  ...ctx.config.forkProfiles.map((fp) => fp.name),
  ...(ctx.spaceMeta?.presetSessions?.map((p) => p.name) ?? []),
])
```

- [ ] **Step 3: Update `onSessionFork` to track activation and augment WS payload**

Replace the existing `onSessionFork` handler in `space-factory.ts`:

```typescript
onSessionFork({ parentId, child }) {
  // 检测是否使用了预设 profile
  const profileName = profiles.consumeLastResolved()
  if (profileName && presetNames.has(profileName) && ctx.onPresetActivated) {
    ctx.onPresetActivated(profileName, child.id)
  }

  if (ctx.eventBus) {
    ctx.eventBus.emit({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      kind: 'node_forked',
      payload: {
        nodeId: child.id,
        label: child.label,
        parentId,
        ...(profileName && presetNames.has(profileName) ? { activatedPreset: profileName } : {}),
      },
    })
  }
},
```

- [ ] **Step 4: Wire callback in SpaceManager.getAgent()**

In `packages/server/src/space/space-manager.ts`, update `getAgent()` to pass the callback:

```typescript
getAgent(id: string, meta: SpaceMeta): StelloAgent {
  const cached = this.agents.get(id)
  if (cached) return cached

  const preset = this.presets.get(meta.presetDirName)
  if (!preset) throw new Error(`Preset not found: ${meta.presetDirName}`)

  const agent = createSpaceAgent({
    dataDir: path.join(this.spacesDir, id),
    config: preset,
    env: this.env,
    spaceMeta: meta,
    eventBus: this.getEventBus(id),
    onPresetActivated: (profileName, sessionId) => {
      this.recordPresetActivation(id, profileName, sessionId).catch(() => {})
    },
  })
  this.agents.set(id, agent)
  return agent
}
```

- [ ] **Step 5: Run existing tests to verify nothing is broken**

Run: `cd /home/i/Code/MindKit && pnpm vitest run packages/server/src/__tests__/space-manager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/space/space-factory.ts packages/server/src/space/space-manager.ts
git commit -m "feat(server): callback injection + TrackingProfileRegistry 接入 onSessionFork"
```

---

### Task 4: Frontend types

**Files:**
- Modify: `packages/web/src/lib/types.ts`

- [ ] **Step 1: Add `activatedPresets` to `SpaceMeta`**

In `packages/web/src/lib/types.ts`, add to the `SpaceMeta` interface (after `skills?: SpaceSkill[]`):

```typescript
/** preset 激活映射：profileName → sessionId */
activatedPresets?: Record<string, string>
```

- [ ] **Step 2: Extend `TopoNode` with `'inactive'` status and `presetName`**

In `packages/web/src/lib/types.ts`, modify `TopoNode`:

```typescript
export interface TopoNode {
  id: string
  label: string
  parentId: string | null
  status: 'active' | 'archived' | 'inactive'
  turns: number
  children: string[]
  /** 仅未激活虚拟节点：对应的 preset profile name */
  presetName?: string
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/types.ts
git commit -m "feat(web): TopoNode 增加 inactive 状态和 presetName 字段"
```

---

### Task 5: KitWorkspace — virtual node merge + WS handler

**Files:**
- Modify: `packages/web/src/pages/KitWorkspace.tsx`

- [ ] **Step 1: Add `activatedPresets` state**

In `KitWorkspace` component, after the `const [detailSessionId, ...]` line, add:

```typescript
const [activatedPresets, setActivatedPresets] = useState<Record<string, string>>({})
```

- [ ] **Step 2: Initialize `activatedPresets` from SpaceMeta on load**

In the `useEffect` that does initial loading (the one with `fetchSpaces()` + `fetchTopology()`), after `setSpaceMeta(meta)`, add:

```typescript
setActivatedPresets(meta?.activatedPresets ?? {})
```

- [ ] **Step 3: Add `useMemo` merge logic**

After the `refreshTopology` callback, before the existing `activeNode` useMemo, add:

```typescript
/** 合并真实拓扑节点 + 未激活 preset 虚拟节点 */
const mergedNodes = useMemo(() => {
  if (!spaceMeta?.presetSessions?.length) return nodes

  const virtualNodes: TopoNode[] = spaceMeta.presetSessions
    .filter((ps) => !activatedPresets[ps.name])
    .map((ps) => ({
      id: `preset:${ps.name}`,
      label: ps.label,
      parentId: null,
      status: 'inactive' as const,
      turns: 0,
      children: [],
      presetName: ps.name,
    }))

  return [...nodes, ...virtualNodes]
}, [nodes, spaceMeta?.presetSessions, activatedPresets])
```

- [ ] **Step 4: Use `mergedNodes` instead of `nodes` in JSX**

Replace all references to `nodes` in the JSX:

1. Replace `<TopologyCanvas nodes={nodes}` with `<TopologyCanvas nodes={mergedNodes}`
2. Replace the `activeNode` useMemo to use `mergedNodes`:
```typescript
const activeNode = useMemo(
  () => mergedNodes.find((n) => n.id === selectedNodeId) ?? null,
  [mergedNodes, selectedNodeId],
)
```
3. Replace the empty-state check `nodes.length === 0` — this is inside TopologyCanvas, so no change needed in KitWorkspace.

- [ ] **Step 5: Update WS handler to process `activatedPreset` in payload**

In the WS `message` event handler, update the `node_forked` case:

```typescript
if (msg.type === 'space_event' && msg.event.kind === 'node_forked') {
  const payload = msg.event.payload as { activatedPreset?: string; nodeId?: string }
  if (payload.activatedPreset && payload.nodeId) {
    setActivatedPresets((prev) => ({
      ...prev,
      [payload.activatedPreset!]: payload.nodeId as string,
    }))
  }
  refreshTopology()
}
```

- [ ] **Step 6: Prevent selecting inactive nodes**

In the `onNodeSelect` callback passed to `TopologyCanvas`, wrap it to skip inactive nodes:

```typescript
onNodeSelect={(nodeId) => {
  if (nodeId.startsWith('preset:')) return
  setSelectedNodeId(nodeId)
}}
onNodeDetail={(nodeId) => {
  if (nodeId.startsWith('preset:')) return
  setDetailSessionId(nodeId)
}}
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/KitWorkspace.tsx
git commit -m "feat(web): KitWorkspace 虚拟 preset 节点合并 + WS 激活处理"
```

---

### Task 6: TopologyCanvas — inactive node rendering

**Files:**
- Modify: `packages/web/src/components/TopologyCanvas.tsx`

- [ ] **Step 1: Add inactive node colors to COLORS**

In `TopologyCanvas.tsx`, add to the `COLORS` object:

```typescript
inactiveNode: '#4B5563',
inactiveGlow: 'rgba(75,85,99,0.1)',
inactiveLine: 'rgba(75,85,99,0.15)',
```

- [ ] **Step 2: Update `computeLayout` to handle inactive nodes**

Inactive nodes (`status === 'inactive'`) should be positioned on an outer ring, not in BFS. Modify `computeLayout`:

After the BFS loop and `ringSpacing` computation, before the return, add inactive node layout:

```typescript
// 未激活 preset 节点 — 散布在外环
const inactiveNodes = nodes.filter((n) => n.status === 'inactive')
const outerRadius = ringSpacing * (layers.length + 1)

for (let i = 0; i < inactiveNodes.length; i++) {
  const node = inactiveNodes[i]!
  const angle = (2 * Math.PI * i) / inactiveNodes.length - Math.PI / 2
  const jitterR = Math.sin(i * 3.7) * ringSpacing * 0.1

  const x = cx + Math.cos(angle) * (outerRadius + jitterR)
  const y = cy + Math.sin(angle) * (outerRadius + jitterR)

  result.push({
    ...node,
    x,
    y,
    size: 4,
    color: COLORS.inactiveNode,
    glowColor: COLORS.inactiveGlow,
    brightness: 0.4,
  })
}
```

Also ensure the BFS loop skips inactive nodes by adding at the start of `computeLayout`:

```typescript
const activeNodes = nodes.filter((n) => n.status !== 'inactive')
```

And use `activeNodes` instead of `nodes` for BFS (the `root` lookup line and `nodeMap`).

- [ ] **Step 3: Update `renderFrame` to render inactive nodes with dashed circle**

In the "画节点" loop inside `renderFrame`, add special rendering for inactive nodes before the existing fill:

```typescript
const isInactive = node.status === 'inactive'

if (isInactive) {
  // 虚线描边圆
  ctx.beginPath()
  ctx.arc(node.x, node.y, animatedSize + 2, 0, Math.PI * 2)
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = COLORS.inactiveNode
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.4
  ctx.stroke()
  ctx.setLineDash([])
}
```

Also ensure inactive nodes are not dimmed by hover (in the `dimmed` calculation):

```typescript
if (isInactive) {
  // 不参与 hover 高亮/暗淡逻辑
  ctx.globalAlpha = 0.4
} else {
  ctx.globalAlpha = dimmed ? 0.25 : node.brightness
}
```

And skip edges for inactive nodes (in the edge drawing loop, add):

```typescript
if (node.status === 'inactive') continue
```

- [ ] **Step 4: Update label rendering for inactive nodes**

In the label section, for inactive nodes use smaller gray text:

```typescript
if (isInactive) {
  ctx.font = '400 9px Outfit, system-ui'
  ctx.fillStyle = COLORS.inactiveNode
  ctx.globalAlpha = 0.4
} else {
  ctx.font = `${isMain ? '600' : '500'} ${isMain ? 12 : 10}px Outfit, system-ui`
  ctx.fillStyle = node.color
  ctx.globalAlpha = dimmed ? 0.2 : 0.9
}
```

- [ ] **Step 5: Verify visually**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/web dev`

1. Create a space from the hackathon-brainstorm preset
2. Verify gray preset nodes appear on the outer ring
3. Verify they have dashed outlines
4. Verify clicking them does nothing
5. Verify normal topology nodes still render correctly

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/TopologyCanvas.tsx
git commit -m "feat(web): TopologyCanvas 灰色未激活 preset 节点渲染"
```

---

### Task 7: TopologyCanvas — activation animation

**Files:**
- Modify: `packages/web/src/components/TopologyCanvas.tsx`

- [ ] **Step 1: Add transition state tracking**

Add a ref to track transitioning nodes, near the other refs:

```typescript
interface NodeTransition {
  nodeId: string
  startX: number
  startY: number
  targetX: number
  targetY: number
  startTime: number
  duration: number  // ms
}

const transitionsRef = useRef<NodeTransition[]>([])
```

- [ ] **Step 2: Detect newly activated nodes and trigger animation**

Add a `useEffect` that compares previous and current nodes to detect activation:

```typescript
const prevNodesRef = useRef<TopoNode[]>([])

useEffect(() => {
  const prevIds = new Set(prevNodesRef.current.filter((n) => n.status !== 'inactive').map((n) => n.id))
  const prevInactive = new Map(
    prevNodesRef.current.filter((n) => n.status === 'inactive').map((n) => [n.id, n])
  )

  // 寻找：之前是 inactive 虚拟节点，现在消失了（被真实节点替代）
  for (const [virtualId] of prevInactive) {
    if (!nodes.find((n) => n.id === virtualId)) {
      // 虚拟节点消失 = 被激活。找到对应的新真实节点
      const presetName = virtualId.replace('preset:', '')
      // 新真实节点 = 在当前 nodes 中存在但在 prevIds 中不存在的节点
      const newRealNode = nodes.find((n) => !prevIds.has(n.id) && n.status !== 'inactive')
      const oldLayout = nodesRef.current.find((n) => n.id === virtualId)

      if (newRealNode && oldLayout) {
        const targetLayout = computeLayout(
          nodes.filter((n) => n.status !== 'inactive'),
          size.width,
          size.height,
        ).find((n) => n.id === newRealNode.id)

        if (targetLayout) {
          transitionsRef.current.push({
            nodeId: newRealNode.id,
            startX: oldLayout.x,
            startY: oldLayout.y,
            targetX: targetLayout.x,
            targetY: targetLayout.y,
            startTime: performance.now(),
            duration: 500,
          })
        }
      }
    }
  }

  prevNodesRef.current = nodes
}, [nodes, size])
```

- [ ] **Step 3: Apply transition offsets in the render loop**

In the `computeLayout` call inside the layout `useEffect`, after computing layout, apply transition overrides:

```typescript
useEffect(() => {
  const layout = computeLayout(nodes, size.width, size.height)
  const now = performance.now()

  for (const node of layout) {
    const transition = transitionsRef.current.find((t) => t.nodeId === node.id)
    if (transition) {
      const elapsed = now - transition.startTime
      const progress = Math.min(1, elapsed / transition.duration)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic

      node.x = transition.startX + (transition.targetX - transition.startX) * eased
      node.y = transition.startY + (transition.targetY - transition.startY) * eased

      if (progress >= 1) {
        // Animation complete — remove transition
        transitionsRef.current = transitionsRef.current.filter((t) => t.nodeId !== node.id)
      }
    }
  }

  nodesRef.current = layout
}, [nodes, size])
```

The rAF loop continuously reads `nodesRef.current`, so transition interpolation must happen in `renderFrame` (not in useEffect). Add `transitions: NodeTransition[]` parameter to `renderFrame`. Before drawing each node, check if it's transitioning:

```typescript
let drawNode = node
const transition = transitions.find((t) => t.nodeId === node.id)
if (transition) {
  const elapsed = time - transition.startTime
  const progress = Math.min(1, elapsed / transition.duration)
  const eased = 1 - Math.pow(1 - progress, 3)
  drawNode = {
    ...node,
    x: transition.startX + (transition.targetX - transition.startX) * eased,
    y: transition.startY + (transition.targetY - transition.startY) * eased,
  }
}
```

Pass `transitionsRef.current` to `renderFrame` in the rAF loop. After each frame, clean up completed transitions:

```typescript
transitionsRef.current = transitionsRef.current.filter(
  (t) => time - t.startTime < t.duration
)
```

- [ ] **Step 4: Verify animation**

1. Open a space with presets
2. Send a message that triggers AI to create a preset session
3. Verify the gray node smoothly moves to its tree position and lights up

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/TopologyCanvas.tsx
git commit -m "feat(web): preset 节点激活动画（位置插值 + 颜色过渡）"
```

---

### Task 8: Progress indicator on Kit cards

**Files:**
- Modify: `packages/web/src/pages/SpaceList.tsx`

- [ ] **Step 1: Add progress badge to Kit card**

In `SpaceList.tsx`, inside the `spaces.map((s) => (...))` block (around line 898-930), find the card's metadata row (the `<div className="flex items-center gap-4 mt-3 text-xs text-text-muted">` at line 921).

Before the date `<span>`, add the progress badge (only if presetSessions exist):

```typescript
{s.presetSessions && s.presetSessions.length > 0 && (() => {
  const total = s.presetSessions!.length
  const activated = Object.keys(s.activatedPresets ?? {}).length
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border/50 font-medium">
      {activated}/{total} 已点亮
    </span>
  )
})()}
```

- [ ] **Step 2: Add progress to KitWorkspace top bar**

In `packages/web/src/pages/KitWorkspace.tsx`, in the top bar (after the mode badge), add:

```typescript
{spaceMeta?.presetSessions && spaceMeta.presetSessions.length > 0 && (
  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border/50 font-medium text-text-muted ml-2">
    {Object.keys(activatedPresets).length}/{spaceMeta.presetSessions.length} 已点亮
  </span>
)}
```

- [ ] **Step 3: Verify**

1. Check SpaceList shows "0/3 已点亮" for hackathon-brainstorm spaces
2. Check KitWorkspace top bar shows the same

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/SpaceList.tsx packages/web/src/pages/KitWorkspace.tsx
git commit -m "feat(web): Kit 卡片和工作区显示 preset 点亮进度"
```

---

### Task 9: Integration testing

- [ ] **Step 1: Run all server tests**

Run: `cd /home/i/Code/MindKit && pnpm vitest run packages/server/src/__tests__/ --exclude '**/stello/**'`
Expected: All PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/web tsc --noEmit && pnpm --filter @mindkit/server tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Manual E2E verification**

1. Start dev server: `cd /home/i/Code/MindKit && pnpm dev`
2. Create a space from hackathon-brainstorm preset
3. Verify 3 gray preset nodes appear on outer ring
4. Send message to main node, trigger AI to use a preset profile
5. Verify the preset node animates into position and lights up
6. Verify progress updates from "0/3" to "1/3"
7. Verify clicking inactive nodes does nothing

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration 修复"
```
