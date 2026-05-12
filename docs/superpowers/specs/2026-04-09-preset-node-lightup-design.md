# Preset Node Light-up Effect Design

## Goal

Preset nodes (from forkProfiles) appear as gray, unconnected stars in the topology canvas when a Kit is created from a template. When AI activates a preset by calling `stello_create_session` with a matching profile, the node "lights up" — moving to its actual parent position, connecting with an edge, and becoming fully interactive.

## Architecture

Pure MindKit implementation. No changes to Stello core (TopologyNode, SessionMeta, SessionTreeNode remain untouched). Preset nodes are virtual frontend constructs merged into the topology rendering pipeline.

## Constraints

- Stello core is read-only for this feature
- Inactive preset nodes are not clickable (no early activation)
- Activation is AI-driven via `stello_create_session` with a profile parameter

---

## 1. Server: Profile Activation Mapping

### Data Model

Add `activatedPresets` to `SpaceMeta`:

```typescript
interface SpaceMeta {
  // ... existing fields
  activatedPresets?: Record<string, string>  // profileName → sessionId
}
```

### Tracking Profile Usage (Solving the profileName Gap)

Stello's `onSessionFork` hook receives `{ parentId, child: TopologyNode }` — no `profileName`. Since we cannot modify Stello core, MindKit uses a **tracking wrapper** around `ForkProfileRegistryImpl`:

```typescript
class TrackingProfileRegistry extends ForkProfileRegistryImpl {
  private _lastResolved: string | null = null

  get(name: string) {
    const result = super.get(name)
    if (result) this._lastResolved = name
    return result
  }

  consumeLastResolved(): string | null {
    const name = this._lastResolved
    this._lastResolved = null
    return name
  }
}
```

This works because the Engine processes tool calls sequentially within a turn: `profiles.get(name)` is called in `executeCreateSession()` before `onSessionFork` fires.

### Construction

In `space-factory.ts`, replace `new ForkProfileRegistryImpl()` with `new TrackingProfileRegistry()`. Build a `presetNames: Set<string>` from `ctx.config.forkProfiles.map(fp => fp.name)` merged with `ctx.spaceMeta?.presetSessions?.map(p => p.name)`.

### Callback Injection

`createSpaceAgent` does not have access to `SpaceManager` or `spaceId`. Solve this by adding a callback to `SpaceFactoryContext`:

```typescript
interface SpaceFactoryContext {
  // ... existing fields
  onPresetActivated?: (profileName: string, sessionId: string) => void
}
```

`SpaceManager.getAgent()` supplies the implementation when calling `createSpaceAgent`:

```typescript
onPresetActivated: (profileName, sessionId) => {
  this.recordPresetActivation(spaceId, profileName, sessionId)
}
```

### Write Timing

In `space-factory.ts`'s `onSessionFork` hook:

```typescript
onSessionFork({ parentId, child }) {
  const profileName = profiles.consumeLastResolved()
  if (profileName && presetNames.has(profileName) && ctx.onPresetActivated) {
    ctx.onPresetActivated(profileName, child.id)
  }
  // ... existing eventBus emit (include activatedPresets in payload)
}
```

### Persistence

`SpaceManager` gets a dedicated internal method `recordPresetActivation(spaceId, profileName, sessionId)` that:
1. Reads current meta
2. Sets `activatedPresets[profileName] = sessionId`
3. Writes back to `meta.json`

This is NOT exposed via `SpaceUpdatePatch` — it's an internal-only write path to prevent client-side manipulation.

### WS Event Payload

The `node_forked` event payload is augmented to include the updated map:

```typescript
{
  nodeId: string
  label: string
  parentId: string
  activatedPresets?: Record<string, string>  // included when a preset was activated
}
```

### API Exposure

`activatedPresets` is part of SpaceMeta, returned by the existing spaces API (`GET /api/spaces`). No new endpoint needed.

---

## 2. Frontend: Virtual Node Merging

### Type Extensions

In `packages/web/src/lib/types.ts`:

```typescript
// TopoNode: add 'inactive' status and optional presetName
export interface TopoNode {
  // ... existing fields
  status: 'active' | 'archived' | 'inactive'  // 'inactive' is new
  presetName?: string  // only for inactive virtual nodes
}

// SpaceMeta: add activatedPresets
export interface SpaceMeta {
  // ... existing fields
  activatedPresets?: Record<string, string>  // profileName → sessionId
}
```

### Merge Logic (KitWorkspace)

After `flattenTree()` produces the real topology nodes:

1. Get `presetSessions` from SpaceMeta
2. Get `activatedPresets` from SpaceMeta (default `{}`)
3. For each preset:
   - If `activatedPresets[preset.name]` exists → the real node is already in the tree, skip
   - Otherwise → create a virtual `TopoNode`:
     - `id`: `preset:${preset.name}` (colon prefix guarantees no collision with UUID-based real session IDs)
     - `parentId`: `null` (no connection until activated)
     - `status`: `'inactive'`
     - `turns`: `0`
     - `children`: `[]`
     - `label`: `preset.label`
     - `presetName`: `preset.name`

### Data Freshness on Activation

When WebSocket receives `node_forked`, the event payload includes the updated `activatedPresets` map. The frontend handler:

1. Updates local `activatedPresets` state from the event payload (no need to re-fetch SpaceMeta)
2. Calls `refreshTopology()` to get the new real node
3. The merge logic now sees the preset as activated → virtual node is dropped, real node renders

This avoids the race condition of fetching SpaceMeta separately from topology.

### Merge Implementation

The virtual node merge should be a `useMemo` derived from `[realNodes, presetSessions, activatedPresets]` — not inside `refreshTopology()`. This ensures:
- `refreshTopology()` only updates real topology nodes
- Virtual nodes are recomputed reactively when any dependency changes
- The WS handler updating `activatedPresets` triggers a re-merge automatically

---

## 3. TopologyCanvas: Rendering Inactive Nodes

### Layout

- Inactive nodes do NOT participate in BFS concentric ring layout
- Positioned on an outer ring at a fixed radius beyond the real topology
- Angles evenly distributed among inactive nodes

### Visual Style

| Property | Inactive | Active (existing) |
|----------|----------|-------------------|
| Color | Gray (`#4B5563`) | Purple/Green/Indigo |
| Size | 4px base | 6-18px based on turns |
| Opacity | 0.4 | 0.8-1.0 |
| Border | Dashed circle | Solid (existing glow) |
| Edge | None | Solid line to parent |
| Label | Gray text, smaller font | Normal |
| Glow/Pulse | None | Breathing effect |

### Interaction

- Hover: Draw label text near the node (on-canvas, not HTML overlay — consistent with existing canvas-only rendering)
- Click: No action (no session to switch to)
- Not highlighted when other nodes are hovered

---

## 4. Activation Transition

### Trigger

WebSocket `node_forked` event with `activatedPresets` in payload → update local state → `refreshTopology()`.

### Animation Sequence

1. Identify which virtual node was activated (match by profileName in updated `activatedPresets`)
2. Smooth position interpolation: node moves from outer ring to its BFS-computed position (~500ms ease-out)
3. Edge drawing: line from parent to activated node fades in
4. Color transition: gray → normal color (based on node type)
5. Size transition: 4px → normal computed size
6. Virtual node is replaced by real TopoNode from topology data

### Implementation

Use the existing `requestAnimationFrame` loop in TopologyCanvas. Track "transitioning" nodes with:
- `startPos`: original outer-ring position
- `targetPos`: new BFS-computed position
- `progress`: 0→1 over ~500ms with ease-out curve

---

## 5. Progress Indicator

Per PRD, template Kits show completion progress (e.g., "2/5 completed").

- Count: `Object.keys(activatedPresets).length` / `presetSessions.length`
- Display location: Kit card in SpaceList + top bar in KitWorkspace
- Only shown when `presetSessions` exists and has items
- `activatedPresets` is already part of SpaceMeta returned by `listSpaces()` (full JSON deserialization)

---

## Edge Cases

- **All presets activated**: No virtual nodes rendered, progress shows "5/5 completed"
- **No presets**: Feature entirely inactive, no virtual nodes, no progress indicator
- **Session deleted after activation**: `activatedPresets` retains the mapping but the real node is gone from topology. The virtual node is NOT re-shown (accepted limitation — preset was activated once, deleting the session is a user's explicit choice)

---

## Files to Modify

### Server
- `packages/server/src/space/space-manager.ts` — Add `activatedPresets` to SpaceMeta + `recordPresetActivation()` internal method
- `packages/server/src/space/space-factory.ts` — Use `TrackingProfileRegistry`, record activation in `onSessionFork`, include `activatedPresets` in WS event payload

### Frontend
- `packages/web/src/lib/types.ts` — Extend TopoNode with 'inactive' status/presetName, extend SpaceMeta with activatedPresets
- `packages/web/src/pages/KitWorkspace.tsx` — Merge virtual preset nodes into topology, handle `activatedPresets` from WS events
- `packages/web/src/components/TopologyCanvas.tsx` — Render inactive nodes (layout, style, hover label), activation animation
- `packages/web/src/pages/SpaceList.tsx` — Progress indicator on Kit cards

### Tests
- `packages/server/src/__tests__/space-manager.test.ts` — activatedPresets persistence + recordPresetActivation
- `packages/server/src/__tests__/space-factory.test.ts` — TrackingProfileRegistry + activation mapping on fork events
