# MindKit Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement MindKit local backend — multi-Space management, REST/WS API, file system persistence, powered by Stello SDK.

**Architecture:** Bottom-up build: FileSystemMemoryEngine (Stello core) → LLM routing → Preset loader → SpaceFactory → SpaceManager → REST API → WS handler → Entry point. Each layer depends only on layers below it.

**Tech Stack:** TypeScript strict · Hono + @hono/node-server + ws · Stello SDK (@stello-ai/core, @stello-ai/session) · Vitest · tsup (ESM)

---

## File Structure

### Stello core (new file in submodule)

| File | Responsibility |
|------|---------------|
| `stello/packages/core/src/memory/file-system-memory-engine.ts` | MemoryEngine implementation using FileSystemAdapter + SessionTree |
| `stello/packages/core/src/memory/__tests__/file-system-memory-engine.test.ts` | Unit tests |

### MindKit server package

| File | Responsibility |
|------|---------------|
| `packages/server/src/llm/resolve-llm.ts` | Model name → Stello LLM adapter factory routing |
| `packages/server/src/preset/preset-loader.ts` | Scan market/presets/ directories, parse preset.json |
| `packages/server/src/space/space-factory.ts` | Build StelloAgentConfig from preset config |
| `packages/server/src/space/space-manager.ts` | Space CRUD + lazy StelloAgent caching |
| `packages/server/src/api/routes.ts` | Hono REST routes |
| `packages/server/src/api/ws-handler.ts` | WebSocket session interaction |
| `packages/server/src/index.ts` | Server entry point — wire everything, start listening |
| `packages/server/src/__tests__/resolve-llm.test.ts` | LLM routing tests |
| `packages/server/src/__tests__/preset-loader.test.ts` | Preset loader tests |
| `packages/server/src/__tests__/space-manager.test.ts` | SpaceManager tests |
| `packages/server/src/__tests__/routes.test.ts` | REST API integration tests |

---

### Task 1: FileSystemMemoryEngine

**Files:**
- Create: `stello/packages/core/src/memory/file-system-memory-engine.ts`
- Create: `stello/packages/core/src/memory/__tests__/file-system-memory-engine.test.ts`
- Modify: `stello/packages/core/src/index.ts` (add export)

**Context:**
- MemoryEngine interface: `stello/packages/core/src/types/memory.ts` (lines 67-92)
- PG reference implementation: `stello/packages/server/src/storage/pg-memory-engine.ts`
- NodeFileSystemAdapter: `stello/packages/core/src/fs/file-system-adapter.ts`
- SessionTree interface: `stello/packages/core/src/types/session.ts` (getAncestors method)
- FileSystemAdapter interface methods: `readJSON`, `writeJSON`, `appendLine`, `readLines`, `mkdir`, `exists`, `readFile`, `writeFile`

**Important:** This goes in the Stello submodule at `/home/i/Code/stello/`. Tests run with `cd stello && pnpm --filter @stello-ai/core run test`.

- [ ] **Step 1: Write failing tests for L1 core read/write**

```typescript
// stello/packages/core/src/memory/__tests__/file-system-memory-engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { FileSystemMemoryEngine } from '../file-system-memory-engine'
import { NodeFileSystemAdapter } from '../../fs'
import { SessionTreeImpl } from '../../session'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

describe('FileSystemMemoryEngine', () => {
  let tmpDir: string
  let adapter: NodeFileSystemAdapter
  let sessions: SessionTreeImpl
  let engine: FileSystemMemoryEngine

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-memory-'))
    adapter = new NodeFileSystemAdapter(tmpDir)
    sessions = new SessionTreeImpl(adapter)
    engine = new FileSystemMemoryEngine(adapter, sessions)
  })

  describe('L1 core', () => {
    it('readCore returns null for empty core', async () => {
      const result = await engine.readCore()
      expect(result).toEqual(null)
    })

    it('writeCore + readCore round-trips', async () => {
      await engine.writeCore('name', 'Alice')
      const result = await engine.readCore('name')
      expect(result).toBe('Alice')
    })

    it('readCore without path returns full object', async () => {
      await engine.writeCore('name', 'Alice')
      await engine.writeCore('age', 25)
      const result = await engine.readCore()
      expect(result).toEqual({ name: 'Alice', age: 25 })
    })

    it('writeCore supports nested dot-path', async () => {
      await engine.writeCore('profile.gpa', 3.8)
      const result = await engine.readCore('profile.gpa')
      expect(result).toBe(3.8)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/i/Code/stello && pnpm --filter @stello-ai/core exec vitest run src/memory/__tests__/file-system-memory-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FileSystemMemoryEngine — L1 core methods**

```typescript
// stello/packages/core/src/memory/file-system-memory-engine.ts
import type { FileSystemAdapter } from '../fs/file-system-adapter'
import type { SessionTree } from '../types/session'
import type { MemoryEngine, TurnRecord, AssembledContext } from '../types/memory'

/**
 * FileSystemMemoryEngine — 基于文件系统的 MemoryEngine 实现
 *
 * 数据布局：
 *   basePath/core.json             — L1 核心档案
 *   basePath/{sessionId}/memory.md — L2 摘要
 *   basePath/{sessionId}/scope.md  — L2 scope
 *   basePath/{sessionId}/index.md  — L2 index
 *   basePath/{sessionId}/records.jsonl — L3 对话记录
 */
export class FileSystemMemoryEngine implements MemoryEngine {
  constructor(
    private readonly fs: FileSystemAdapter,
    private readonly sessions: SessionTree,
  ) {}

  /** 读取 L1 核心档案（支持点路径） */
  async readCore(path?: string): Promise<unknown> {
    const core = await this.fs.readJSON<Record<string, unknown>>('core.json')
    if (!core) return path ? null : null
    if (!path) return core
    return getByDotPath(core, path)
  }

  /** 写入 L1 核心档案的某个字段 */
  async writeCore(path: string, value: unknown): Promise<void> {
    const core = (await this.fs.readJSON<Record<string, unknown>>('core.json')) ?? {}
    setByDotPath(core, path, value)
    await this.fs.writeJSON('core.json', core)
  }

  // per-session 路径使用 sessions/ 前缀，与 SessionTreeImpl 共享同一 FileSystemAdapter
  private sessionPath(sessionId: string, file: string): string {
    return `sessions/${sessionId}/${file}`
  }

  async readMemory(_sessionId: string): Promise<string | null> { throw new Error('TODO') }
  async writeMemory(_sessionId: string, _content: string): Promise<void> { throw new Error('TODO') }
  async readScope(_sessionId: string): Promise<string | null> { throw new Error('TODO') }
  async writeScope(_sessionId: string, _content: string): Promise<void> { throw new Error('TODO') }
  async readIndex(_sessionId: string): Promise<string | null> { throw new Error('TODO') }
  async writeIndex(_sessionId: string, _content: string): Promise<void> { throw new Error('TODO') }
  async appendRecord(_sessionId: string, _record: TurnRecord): Promise<void> { throw new Error('TODO') }
  async readRecords(_sessionId: string): Promise<TurnRecord[]> { throw new Error('TODO') }
  async assembleContext(_sessionId: string): Promise<AssembledContext> { throw new Error('TODO') }
}

/** 按点路径读取嵌套对象 */
function getByDotPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return current ?? null
}

/** 按点路径设置嵌套对象 */
function setByDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  current[keys[keys.length - 1]!] = value
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/i/Code/stello && pnpm --filter @stello-ai/core exec vitest run src/memory/__tests__/file-system-memory-engine.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Add tests for L2 read/write (memory, scope, index)**

Add to the test file:

```typescript
  describe('L2 memory/scope/index', () => {
    let sessionId: string

    beforeEach(async () => {
      const root = await (sessions as SessionTreeImpl).createRoot('test')
      sessionId = root.id
    })

    it('readMemory returns null for empty session', async () => {
      expect(await engine.readMemory(sessionId)).toBeNull()
    })

    it('writeMemory + readMemory round-trips', async () => {
      await engine.writeMemory(sessionId, '# Summary\nTest content')
      expect(await engine.readMemory(sessionId)).toBe('# Summary\nTest content')
    })

    it('readScope/writeScope round-trips', async () => {
      await engine.writeScope(sessionId, 'scope content')
      expect(await engine.readScope(sessionId)).toBe('scope content')
    })

    it('readIndex/writeIndex round-trips', async () => {
      await engine.writeIndex(sessionId, 'index content')
      expect(await engine.readIndex(sessionId)).toBe('index content')
    })
  })
```

- [ ] **Step 6: Implement L2 methods**

Replace the TODO stubs (using `sessionPath` helper for `sessions/` prefix):

```typescript
  /** 读取某 Session 的 memory.md */
  async readMemory(sessionId: string): Promise<string | null> {
    return this.fs.readFile(this.sessionPath(sessionId, 'memory.md'))
  }

  /** 写入某 Session 的 memory.md */
  async writeMemory(sessionId: string, content: string): Promise<void> {
    await this.fs.mkdir(`sessions/${sessionId}`)
    await this.fs.writeFile(this.sessionPath(sessionId, 'memory.md'), content)
  }

  /** 读取某 Session 的 scope.md */
  async readScope(sessionId: string): Promise<string | null> {
    return this.fs.readFile(this.sessionPath(sessionId, 'scope.md'))
  }

  /** 写入某 Session 的 scope.md */
  async writeScope(sessionId: string, content: string): Promise<void> {
    await this.fs.mkdir(`sessions/${sessionId}`)
    await this.fs.writeFile(this.sessionPath(sessionId, 'scope.md'), content)
  }

  /** 读取某 Session 的 index.md */
  async readIndex(sessionId: string): Promise<string | null> {
    return this.fs.readFile(this.sessionPath(sessionId, 'index.md'))
  }

  /** 写入某 Session 的 index.md */
  async writeIndex(sessionId: string, content: string): Promise<void> {
    await this.fs.mkdir(`sessions/${sessionId}`)
    await this.fs.writeFile(this.sessionPath(sessionId, 'index.md'), content)
  }
```

- [ ] **Step 7: Run tests to verify L2 passes**

Run: `cd /home/i/Code/stello && pnpm --filter @stello-ai/core exec vitest run src/memory/__tests__/file-system-memory-engine.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 8: Add tests for L3 records**

```typescript
  describe('L3 records', () => {
    let sessionId: string

    beforeEach(async () => {
      const root = await (sessions as SessionTreeImpl).createRoot('test')
      sessionId = root.id
    })

    it('readRecords returns empty for new session', async () => {
      expect(await engine.readRecords(sessionId)).toEqual([])
    })

    it('appendRecord + readRecords round-trips', async () => {
      const record: TurnRecord = {
        role: 'user',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      await engine.appendRecord(sessionId, record)
      const records = await engine.readRecords(sessionId)
      expect(records).toEqual([record])
    })

    it('appendRecord preserves order', async () => {
      const r1: TurnRecord = { role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:00Z' }
      const r2: TurnRecord = { role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:01Z' }
      await engine.appendRecord(sessionId, r1)
      await engine.appendRecord(sessionId, r2)
      const records = await engine.readRecords(sessionId)
      expect(records).toHaveLength(2)
      expect(records[0]!.role).toBe('user')
      expect(records[1]!.role).toBe('assistant')
    })

    it('replaceRecords overwrites all records', async () => {
      const r1: TurnRecord = { role: 'user', content: 'old', timestamp: '2026-01-01T00:00:00Z' }
      await engine.appendRecord(sessionId, r1)
      const replacement: TurnRecord = { role: 'user', content: 'new', timestamp: '2026-01-01T00:00:01Z' }
      await engine.replaceRecords!(sessionId, [replacement])
      const records = await engine.readRecords(sessionId)
      expect(records).toEqual([replacement])
    })
  })
```

- [ ] **Step 9: Implement L3 methods**

```typescript
  /** 追加一条 L3 对话记录 */
  async appendRecord(sessionId: string, record: TurnRecord): Promise<void> {
    await this.fs.mkdir(`sessions/${sessionId}`)
    await this.fs.appendLine(this.sessionPath(sessionId, 'records.jsonl'), JSON.stringify(record))
  }

  /** 覆盖某 Session 的全部 L3 对话记录 */
  async replaceRecords(sessionId: string, records: TurnRecord[]): Promise<void> {
    await this.fs.mkdir(`sessions/${sessionId}`)
    const content = records.map(r => JSON.stringify(r)).join('\n')
    await this.fs.writeFile(this.sessionPath(sessionId, 'records.jsonl'), content + (records.length > 0 ? '\n' : ''))
  }

  /** 读取某 Session 的所有 L3 对话记录 */
  async readRecords(sessionId: string): Promise<TurnRecord[]> {
    const lines = await this.fs.readLines(this.sessionPath(sessionId, 'records.jsonl'))
    return lines
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as TurnRecord)
  }
```

- [ ] **Step 10: Run tests to verify L3 passes**

Run: `cd /home/i/Code/stello && pnpm --filter @stello-ai/core exec vitest run src/memory/__tests__/file-system-memory-engine.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 11: Add test for assembleContext**

```typescript
  describe('assembleContext', () => {
    it('assembles core + ancestor memories + current memory + scope', async () => {
      // 创建拓扑：root → child
      const root = await (sessions as SessionTreeImpl).createRoot('Root')
      const child = await sessions.createChild({ parentId: root.id, label: 'Child' })

      // 写入数据
      await engine.writeCore('name', 'TestUser')
      await engine.writeMemory(root.id, 'root memory')
      await engine.writeMemory(child.id, 'child memory')
      await engine.writeScope(child.id, 'child scope')

      const ctx = await engine.assembleContext(child.id)
      expect(ctx.core).toEqual({ name: 'TestUser' })
      expect(ctx.memories).toEqual(['root memory'])  // 祖先链（不含自己）
      expect(ctx.currentMemory).toBe('child memory')
      expect(ctx.scope).toBe('child scope')
    })

    it('returns empty memories for root session', async () => {
      const root = await (sessions as SessionTreeImpl).createRoot('Root')
      await engine.writeCore('x', 1)
      const ctx = await engine.assembleContext(root.id)
      expect(ctx.memories).toEqual([])
      expect(ctx.currentMemory).toBeNull()
    })
  })
```

- [ ] **Step 12: Implement assembleContext**

Note: `readCore()` reads from root `core.json`, while per-session data uses `sessions/` prefix. This is intentional — core.json is global, session data is per-session.

```typescript
  /** 按继承策略组装上下文 */
  async assembleContext(sessionId: string): Promise<AssembledContext> {
    const core = (await this.fs.readJSON<Record<string, unknown>>('core.json')) ?? {}

    // 收集祖先链 memory（从根到直接父，不含自己）
    const ancestors = await this.sessions.getAncestors(sessionId)
    const memories: string[] = []
    for (const ancestor of ancestors) {
      const mem = await this.readMemory(ancestor.id)
      if (mem) memories.push(mem)
    }

    const currentMemory = await this.readMemory(sessionId)
    const scope = await this.readScope(sessionId)

    return { core, memories, currentMemory, scope }
  }
```

- [ ] **Step 13: Run all tests to verify**

Run: `cd /home/i/Code/stello && pnpm --filter @stello-ai/core exec vitest run src/memory/__tests__/file-system-memory-engine.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 14: Export from core index**

Add to `stello/packages/core/src/index.ts`:

```typescript
export { FileSystemMemoryEngine } from './memory/file-system-memory-engine';
```

- [ ] **Step 15: Build core to verify export works**

Run: `cd /home/i/Code/stello && pnpm --filter @stello-ai/core run build`
Expected: Successful build

- [ ] **Step 16: Commit**

```bash
cd /home/i/Code/stello
git add packages/core/src/memory/ packages/core/src/index.ts
git commit -m "feat(core): add FileSystemMemoryEngine"
```

---

### Task 2: LLM Routing

**Files:**
- Create: `packages/server/src/llm/resolve-llm.ts`
- Create: `packages/server/src/__tests__/resolve-llm.test.ts`

**Context:**
- `@stello-ai/core` re-exports `createClaude`, `createGPT` from session package
- `createClaude` options: `{ model, apiKey, maxContextTokens? }` — see `stello/packages/session/src/adapters/claude.ts`
- `createGPT` options: `{ model, apiKey, maxContextTokens? }` — see `stello/packages/session/src/adapters/gpt.ts`
- `LLMCallFn` type: `(messages: Array<{ role: string; content: string }>) => Promise<string>` — see `stello/packages/core/src/llm/defaults.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/src/__tests__/resolve-llm.test.ts
import { describe, it, expect } from 'vitest'
import { resolveLLM, toLLMCallFn } from '../llm/resolve-llm'

describe('resolveLLM', () => {
  const env = {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
  }

  it('routes claude-* models to Anthropic adapter', () => {
    const adapter = resolveLLM('claude-sonnet-4-20250514', env)
    expect(adapter).toBeDefined()
    expect(adapter.maxContextTokens).toBeGreaterThan(0)
  })

  it('routes gpt-* models to GPT adapter', () => {
    const adapter = resolveLLM('gpt-4o', env)
    expect(adapter).toBeDefined()
    expect(adapter.maxContextTokens).toBeGreaterThan(0)
  })

  it('routes o3-* models to GPT adapter', () => {
    const adapter = resolveLLM('o3-mini', env)
    expect(adapter).toBeDefined()
  })

  it('routes o4-* models to GPT adapter', () => {
    const adapter = resolveLLM('o4-mini', env)
    expect(adapter).toBeDefined()
  })

  it('throws for unknown model prefix', () => {
    expect(() => resolveLLM('llama-3', env)).toThrow()
  })

  it('throws when API key is missing', () => {
    expect(() => resolveLLM('claude-sonnet-4-20250514', {})).toThrow('ANTHROPIC_API_KEY')
  })
})

describe('toLLMCallFn', () => {
  it('wraps LLMAdapter into LLMCallFn', async () => {
    const mockAdapter = {
      maxContextTokens: 100000,
      complete: async () => ({ content: 'test response' }),
    }
    const callFn = toLLMCallFn(mockAdapter)
    const result = await callFn([{ role: 'user', content: 'hi' }])
    expect(result).toBe('test response')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/resolve-llm.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolve-llm.ts**

```typescript
// packages/server/src/llm/resolve-llm.ts
import { createClaude, createGPT } from '@stello-ai/core'
import type { LLMCallFn } from '@stello-ai/core'
import type { LLMAdapter } from '@stello-ai/session'

/** 按 model 名前缀路由到对应的 Stello LLM adapter */
export function resolveLLM(
  model: string,
  env: Record<string, string | undefined>,
): LLMAdapter {
  if (model.startsWith('claude-')) {
    const apiKey = env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for Claude models')
    return createClaude({ model: model as Parameters<typeof createClaude>[0]['model'], apiKey })
  }

  if (model.startsWith('gpt-') || model.startsWith('o3-') || model.startsWith('o4-')) {
    const apiKey = env['OPENAI_API_KEY']
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for GPT/O-series models')
    return createGPT({ model: model as Parameters<typeof createGPT>[0]['model'], apiKey })
  }

  throw new Error(`Unsupported model: ${model}. Expected claude-*, gpt-*, o3-*, or o4-* prefix.`)
}

/** 将 LLMAdapter 包装为 LLMCallFn（供 createDefaultConsolidateFn/IntegrateFn 使用） */
export function toLLMCallFn(adapter: LLMAdapter): LLMCallFn {
  return async (messages) => {
    const result = await adapter.complete(
      messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    )
    return result.content ?? ''
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/resolve-llm.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/llm/ packages/server/src/__tests__/resolve-llm.test.ts
git commit -m "feat(server): add LLM routing — model prefix → Stello adapter"
```

---

### Task 3: Preset Loader

**Files:**
- Create: `packages/server/src/preset/preset-loader.ts`
- Create: `packages/server/src/__tests__/preset-loader.test.ts`

**Context:**
- Presets live in `market/presets/{dirName}/preset.json`
- Example preset: `market/presets/example/preset.json`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/src/__tests__/preset-loader.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { loadPresets, type PresetConfig } from '../preset/preset-loader'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

describe('loadPresets', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-'))
  })

  it('returns empty array for empty directory', async () => {
    const presets = await loadPresets(tmpDir)
    expect(presets).toEqual([])
  })

  it('loads a valid preset', async () => {
    const presetDir = path.join(tmpDir, 'test-preset')
    fs.mkdirSync(presetDir)
    fs.writeFileSync(
      path.join(presetDir, 'preset.json'),
      JSON.stringify({
        name: 'Test',
        description: 'A test preset',
        systemPrompt: 'You are helpful.',
        forkProfiles: [],
        skills: [],
        llm: { model: 'claude-sonnet-4-20250514' },
        consolidatePrompt: null,
        integratePrompt: null,
      }),
    )

    const presets = await loadPresets(tmpDir)
    expect(presets).toHaveLength(1)
    expect(presets[0]!.dirName).toBe('test-preset')
    expect(presets[0]!.name).toBe('Test')
    expect(presets[0]!.llm.model).toBe('claude-sonnet-4-20250514')
  })

  it('skips directories without preset.json', async () => {
    fs.mkdirSync(path.join(tmpDir, 'empty-dir'))
    const presets = await loadPresets(tmpDir)
    expect(presets).toEqual([])
  })

  it('loads multiple presets', async () => {
    for (const name of ['a', 'b']) {
      const dir = path.join(tmpDir, name)
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, 'preset.json'),
        JSON.stringify({
          name, description: name, systemPrompt: 'hi',
          forkProfiles: [], skills: [],
          llm: { model: 'claude-sonnet-4-20250514' },
          consolidatePrompt: null, integratePrompt: null,
        }),
      )
    }
    const presets = await loadPresets(tmpDir)
    expect(presets).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/preset-loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement preset-loader.ts**

```typescript
// packages/server/src/preset/preset-loader.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** Preset 配置结构 */
export interface PresetConfig {
  /** preset 目录名，作为唯一标识 */
  dirName: string
  name: string
  description: string
  systemPrompt: string
  forkProfiles: Array<{
    name: string
    systemPrompt?: string
    systemPromptMode?: 'preset' | 'prepend' | 'append'
    context?: 'none' | 'inherit'
    skills?: string[]
  }>
  skills: Array<{
    name: string
    description: string
    content: string
  }>
  llm: { model: string }
  consolidatePrompt: string | null
  integratePrompt: string | null
}

/** 扫描 presetsDir 下每个子目录的 preset.json，返回解析后的配置列表 */
export async function loadPresets(presetsDir: string): Promise<PresetConfig[]> {
  const entries = await fs.readdir(presetsDir, { withFileTypes: true })
  const presets: PresetConfig[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const presetPath = path.join(presetsDir, entry.name, 'preset.json')
    try {
      const content = await fs.readFile(presetPath, 'utf-8')
      const raw = JSON.parse(content) as Omit<PresetConfig, 'dirName'>
      presets.push({ ...raw, dirName: entry.name })
    } catch {
      // 跳过没有 preset.json 的目录
      continue
    }
  }

  return presets
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/preset-loader.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/preset/ packages/server/src/__tests__/preset-loader.test.ts
git commit -m "feat(server): add preset loader"
```

---

### Task 4: SpaceFactory

**Files:**
- Create: `packages/server/src/space/space-factory.ts`

**Context:**
- Spec Section 2.3 details the full construction steps
- StelloAgentConfig: `stello/packages/core/src/agent/stello-agent.ts` (lines 100-107)
- StelloAgentCapabilitiesConfig: same file (lines 42-48)
- StelloAgentSessionConfig: same file (lines 57-74)
- createDefaultConsolidateFn/IntegrateFn: `stello/packages/core/src/llm/defaults.ts`
- **Demo reference (critical):** `stello/demo/stello-agent-chat/chat-devtools.ts` — follow the same `InMemoryStorageAdapter` + hydration pattern
- EngineLifecycleAdapter: `stello/packages/core/src/engine/stello-engine.ts` (lines 46-51)
- `loadSession(id, options)` signature: `stello/packages/session/src/create-session.ts` (line 472) — takes TWO args `(id: string, options: LoadSessionOptions)`
- `createSession(options)` signature: same file (line 446) — takes one arg with optional `id`
- `SessionStorage` interface: `stello/packages/session/src/types/storage.ts` — required for session creation
- `InMemoryStorageAdapter`: `stello/packages/session/src/mocks/in-memory-storage.ts` — re-exported from core

**Key pattern (from demo):** Sessions use `InMemoryStorageAdapter` as runtime storage. On session resolve:
1. Create/get `InMemoryStorageAdapter` (one per space, shared)
2. Put session meta + system prompt into the adapter
3. Hydrate L3 records from `MemoryEngine` into the adapter
4. Call `loadSession(id, { storage: adapter, llm, ... })` to get the Session
5. On `afterTurn`, persist L3 records back from session to `MemoryEngine`

**Note:** SpaceFactory is hard to unit test in isolation (it assembles real Stello objects). It will be integration-tested through SpaceManager in Task 5. This task focuses on correct assembly.

- [ ] **Step 1: Implement space-factory.ts**

**Important path note:** `NodeFileSystemAdapter` base path = Space root (`data/spaces/{id}/`), NOT `data/spaces/{id}/sessions/`. This is because `SessionTreeImpl` internally prefixes paths with `sessions/` (e.g., `sessions/{id}/meta.json`). `FileSystemMemoryEngine` also uses `sessions/` prefix for per-session data. `core.json` lives at the adapter root.

```typescript
// packages/server/src/space/space-factory.ts
import {
  createStelloAgent,
  NodeFileSystemAdapter,
  SessionTreeImpl,
  FileSystemMemoryEngine,
  SkillRouterImpl,
  ForkProfileRegistryImpl,
  Scheduler,
  createDefaultConsolidateFn,
  createDefaultIntegrateFn,
  DEFAULT_CONSOLIDATE_PROMPT,
  DEFAULT_INTEGRATE_PROMPT,
  InMemoryStorageAdapter,
  loadSession,
  loadMainSession,
  buildSessionToolList,
} from '@stello-ai/core'
import type {
  StelloAgentConfig,
  EngineLifecycleAdapter,
  EngineToolRuntime,
  MemoryEngine,
} from '@stello-ai/core'
import type { ConfirmProtocol } from '@stello-ai/core'
import type { PresetConfig } from '../preset/preset-loader'
import { resolveLLM, toLLMCallFn } from '../llm/resolve-llm'

/** SpaceFactory 构建所需的上下文 */
export interface SpaceFactoryContext {
  /** Space 数据目录（如 data/spaces/{id}） */
  dataDir: string
  /** preset 配置（从 config.json 读取） */
  config: PresetConfig
  /** 环境变量（API key 等） */
  env: Record<string, string | undefined>
}

/** 从 MemoryEngine 恢复 session 运行态到 InMemoryStorageAdapter */
async function hydrateSession(
  storage: InMemoryStorageAdapter,
  memory: MemoryEngine,
  sessionId: string,
  label: string,
  systemPrompt: string,
): Promise<void> {
  // 注册 session 元数据
  const now = new Date().toISOString()
  await storage.putSession({
    id: sessionId,
    label,
    role: 'standard',
    status: 'active',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  })
  await storage.putSystemPrompt(sessionId, systemPrompt)

  // 恢复 L3 记录
  const records = await memory.readRecords(sessionId).catch(() => [])
  for (const record of records) {
    await storage.appendRecord(sessionId, {
      role: record.role,
      content: record.content,
      timestamp: record.timestamp,
      ...(record.metadata?.toolCallId && typeof record.metadata.toolCallId === 'string'
        ? { toolCallId: record.metadata.toolCallId }
        : {}),
      ...(Array.isArray(record.metadata?.toolCalls)
        ? { toolCalls: record.metadata.toolCalls as Array<{ id: string; name: string; input: Record<string, unknown> }> }
        : {}),
    })
  }

  // 恢复 L2 memory
  const l2 = await memory.readMemory(sessionId).catch(() => null)
  if (l2) await storage.putMemory(sessionId, l2)

  // 恢复 scope/insight
  const scope = await memory.readScope(sessionId).catch(() => null)
  if (scope) await storage.putInsight(sessionId, scope)
}

/** 将 preset config 组装为完整 StelloAgentConfig，创建 StelloAgent */
export function createSpaceAgent(ctx: SpaceFactoryContext) {
  // adapter base = Space root（SessionTreeImpl 内部用 sessions/ 前缀）
  const fs = new NodeFileSystemAdapter(ctx.dataDir)
  const sessions = new SessionTreeImpl(fs)
  const memory = new FileSystemMemoryEngine(fs, sessions)

  // 共享的 InMemoryStorageAdapter — session 组件的运行时存储
  const sessionStorage = new InMemoryStorageAdapter()

  // LLM
  const llmAdapter = resolveLLM(ctx.config.llm.model, ctx.env)
  const llmCallFn = toLLMCallFn(llmAdapter)

  // Skills
  const skillRouter = new SkillRouterImpl()
  for (const skill of ctx.config.skills) {
    skillRouter.register(skill)
  }

  // Fork profiles
  const profiles = new ForkProfileRegistryImpl()
  for (const fp of ctx.config.forkProfiles) {
    profiles.register(fp.name, {
      systemPrompt: fp.systemPrompt,
      systemPromptMode: fp.systemPromptMode,
      context: fp.context,
      skills: fp.skills,
    })
  }

  // Lifecycle
  const lifecycle: EngineLifecycleAdapter = {
    bootstrap: async (sessionId) => ({
      context: await memory.assembleContext(sessionId),
      session: (await sessions.get(sessionId))!,
    }),
    afterTurn: async (sessionId, userMsg, assistantMsg) => {
      await memory.appendRecord(sessionId, userMsg)
      await memory.appendRecord(sessionId, assistantMsg)
      const current = await sessions.get(sessionId)
      if (current) {
        await sessions.updateMeta(sessionId, { turnCount: current.turnCount + 1 })
      }
      return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
    },
  }

  // Tools — 空实现，内置 tool 由 Engine 管理
  const tools: EngineToolRuntime = {
    getToolDefinitions: () => [],
    executeTool: async () => ({ success: false, error: 'no custom tools' }),
  }

  // Confirm — 自动批准 split（用延迟引用 agent）
  let agentRef: ReturnType<typeof createStelloAgent> | null = null
  const confirm: ConfirmProtocol = {
    confirmSplit: async (proposal) => {
      if (!agentRef) throw new Error('Agent not initialized')
      return agentRef.forkSession(proposal.parentId, {
        label: proposal.suggestedLabel,
        scope: proposal.suggestedScope,
      })
    },
    dismissSplit: async () => {},
    confirmUpdate: async () => {},
    dismissUpdate: async () => {},
  }

  // Consolidate / Integrate
  const consolidatePrompt = ctx.config.consolidatePrompt ?? DEFAULT_CONSOLIDATE_PROMPT
  const integratePrompt = ctx.config.integratePrompt ?? DEFAULT_INTEGRATE_PROMPT

  // Session 工具列表（内置 tool + 用户 tool）
  const sessionTools = buildSessionToolList(
    { getAll: () => [], get: () => undefined, register: () => {} },  // 空 ToolRegistry
    skillRouter,
    profiles,
  )

  const config: StelloAgentConfig = {
    sessions,
    memory,
    session: {
      sessionResolver: async (sessionId) => {
        // 先恢复运行态到 InMemoryStorageAdapter
        const meta = await sessions.get(sessionId)
        if (!meta) throw new Error(`Session not found: ${sessionId}`)
        await hydrateSession(sessionStorage, memory, sessionId, meta.label, ctx.config.systemPrompt)
        const session = await loadSession(sessionId, {
          storage: sessionStorage,
          llm: llmAdapter,
          tools: [...sessionTools],
        })
        if (!session) throw new Error(`Failed to load session: ${sessionId}`)
        return session
      },
      mainSessionResolver: async () => {
        const root = await sessions.getRoot()
        await hydrateSession(sessionStorage, memory, root.id, root.label, ctx.config.systemPrompt)
        const mainSession = await loadMainSession(root.id, {
          storage: sessionStorage,
          llm: llmAdapter,
          tools: [...sessionTools],
        })
        if (!mainSession) throw new Error('Failed to load main session')
        return {
          async integrate(fn: Parameters<typeof mainSession.integrate>[0]) {
            const result = await mainSession.integrate(fn)
            // 同步 synthesis + insights 到文件持久化层
            if (result) {
              await memory.writeMemory(root.id, result.synthesis)
              for (const { sessionId, content } of result.insights) {
                await memory.writeScope(sessionId, content)
              }
            }
            return result
          },
        }
      },
      consolidateFn: createDefaultConsolidateFn(consolidatePrompt, llmCallFn),
      integrateFn: createDefaultIntegrateFn(integratePrompt, llmCallFn),
    },
    capabilities: {
      lifecycle,
      tools,
      skills: skillRouter,
      confirm,
      profiles,
    },
    orchestration: {
      scheduler: new Scheduler({
        consolidation: { trigger: 'everyNTurns', everyNTurns: 3 },
        integration: { trigger: 'afterConsolidate' },
      }),
      hooks: {
        onRoundEnd({ sessionId, input, turn }) {
          const userRecord = { role: 'user' as const, content: input, timestamp: new Date().toISOString() }
          const assistantRecord = { role: 'assistant' as const, content: turn.finalContent ?? turn.rawResponse, timestamp: new Date().toISOString() }
          lifecycle.afterTurn(sessionId, userRecord, assistantRecord).catch(() => {})
        },
      },
    },
  }

  const agent = createStelloAgent(config)
  agentRef = agent
  return agent
}
```

**Implementation notes for the engineer:**
- The `sessionResolver` / `mainSessionResolver` signatures may need minor adjustments based on exact Stello session API shapes. Check `stello/packages/session/src/types/functions.ts` for `LoadSessionOptions` and `LoadMainSessionOptions`.
- The `hydrateSession` function follows the same pattern as `demo/stello-agent-chat/chat-devtools.ts:registerStandardSession + hydrateRuntimeState`.
- The `buildSessionToolList` import and usage may need adjustment — check if it's exported from core and what arguments it expects. If not available, use an empty tools array: `tools: []`.
- `confirmSplit` follows the demo's pattern: use `agentRef.forkSession()` (not `sessions.createChild()` directly) so the full fork flow (topology + session creation) is handled by the agent.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /home/i/Code/MindKit && pnpm --filter @stello-ai/session run build && pnpm --filter @stello-ai/core run build && pnpm --filter @mindkit/server run typecheck`
Expected: PASS (may need minor type adjustments)

- [ ] **Step 3: Commit**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/space/space-factory.ts
git commit -m "feat(server): add SpaceFactory — preset config → StelloAgent"
```

---

### Task 5: SpaceManager

**Files:**
- Create: `packages/server/src/space/space-manager.ts`
- Create: `packages/server/src/__tests__/space-manager.test.ts`

**Context:**
- Spec Section 2.2: CRUD + lazy loading
- Space data layout: `data/spaces/{id}/space.json` + `config.json` + `sessions/`
- SpaceFactory: `packages/server/src/space/space-factory.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/src/__tests__/space-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SpaceManager } from '../space/space-manager'
import type { PresetConfig } from '../preset/preset-loader'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const mockPreset: PresetConfig = {
  dirName: 'test',
  name: 'Test Preset',
  description: 'A test',
  systemPrompt: 'You are helpful.',
  forkProfiles: [],
  skills: [],
  llm: { model: 'claude-sonnet-4-20250514' },
  consolidatePrompt: null,
  integratePrompt: null,
}

describe('SpaceManager', () => {
  let tmpDir: string
  let manager: SpaceManager

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-'))
    manager = new SpaceManager(tmpDir, [mockPreset])
  })

  describe('createSpace', () => {
    it('creates space directory and files', async () => {
      const space = await manager.createSpace('test')
      expect(space.id).toBeDefined()
      expect(space.name).toBe('Test Preset')
      expect(space.presetName).toBe('test')

      // Verify files exist
      const spaceDir = path.join(tmpDir, space.id)
      expect(fs.existsSync(path.join(spaceDir, 'space.json'))).toBe(true)
      expect(fs.existsSync(path.join(spaceDir, 'config.json'))).toBe(true)
      expect(fs.existsSync(path.join(spaceDir, 'sessions'))).toBe(true)
    })

    it('throws for unknown preset', async () => {
      await expect(manager.createSpace('nonexistent')).rejects.toThrow()
    })
  })

  describe('listSpaces', () => {
    it('returns empty for no spaces', async () => {
      const spaces = await manager.listSpaces()
      expect(spaces).toEqual([])
    })

    it('lists created spaces', async () => {
      await manager.createSpace('test')
      await manager.createSpace('test')
      const spaces = await manager.listSpaces()
      expect(spaces).toHaveLength(2)
    })
  })

  describe('getSpace', () => {
    it('returns null for nonexistent space', async () => {
      expect(await manager.getSpace('nonexistent')).toBeNull()
    })

    it('returns created space', async () => {
      const created = await manager.createSpace('test')
      const found = await manager.getSpace(created.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })
  })

  describe('deleteSpace', () => {
    it('deletes space directory', async () => {
      const space = await manager.createSpace('test')
      await manager.deleteSpace(space.id)
      expect(await manager.getSpace(space.id)).toBeNull()
    })

    it('throws for nonexistent space', async () => {
      await expect(manager.deleteSpace('nonexistent')).rejects.toThrow()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/space-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement space-manager.ts**

```typescript
// packages/server/src/space/space-manager.ts
import * as fs from 'node:fs/promises'
import * as nodefs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StelloAgent } from '@stello-ai/core'
import type { PresetConfig } from '../preset/preset-loader'
import { createSpaceAgent } from './space-factory'

/** Space 元信息 */
export interface SpaceInfo {
  id: string
  name: string
  presetName: string
  createdAt: string
  updatedAt: string
}

/** Space CRUD + StelloAgent 懒加载管理器 */
export class SpaceManager {
  private readonly agents = new Map<string, StelloAgent>()
  private readonly presetMap: Map<string, PresetConfig>

  constructor(
    private readonly dataDir: string,
    presets: PresetConfig[],
    private readonly env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  ) {
    this.presetMap = new Map(presets.map(p => [p.dirName, p]))
  }

  /** 列出所有 Space 元信息 */
  async listSpaces(): Promise<SpaceInfo[]> {
    try {
      const entries = await fs.readdir(this.dataDir, { withFileTypes: true })
      const spaces: SpaceInfo[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const info = await this.readSpaceJson(entry.name)
        if (info) spaces.push(info)
      }
      return spaces
    } catch {
      return []
    }
  }

  /** 获取单个 Space 元信息 */
  async getSpace(id: string): Promise<SpaceInfo | null> {
    return this.readSpaceJson(id)
  }

  /** 创建 Space */
  async createSpace(presetName: string): Promise<SpaceInfo> {
    const preset = this.presetMap.get(presetName)
    if (!preset) throw new Error(`Preset not found: ${presetName}`)

    const id = randomUUID()
    const spaceDir = path.join(this.dataDir, id)
    const now = new Date().toISOString()

    await fs.mkdir(path.join(spaceDir, 'sessions'), { recursive: true })

    const info: SpaceInfo = {
      id,
      name: preset.name,
      presetName,
      createdAt: now,
      updatedAt: now,
    }
    await fs.writeFile(path.join(spaceDir, 'space.json'), JSON.stringify(info, null, 2))
    await fs.writeFile(path.join(spaceDir, 'config.json'), JSON.stringify(preset, null, 2))

    return info
  }

  /** 删除 Space */
  async deleteSpace(id: string): Promise<void> {
    const spaceDir = path.join(this.dataDir, id)
    if (!nodefs.existsSync(spaceDir)) {
      throw new Error(`Space not found: ${id}`)
    }
    this.agents.delete(id)
    await fs.rm(spaceDir, { recursive: true, force: true })
  }

  /** 懒加载 StelloAgent */
  async getAgent(id: string): Promise<StelloAgent> {
    const cached = this.agents.get(id)
    if (cached) return cached

    const spaceDir = path.join(this.dataDir, id)
    const configPath = path.join(spaceDir, 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(configContent) as PresetConfig

    const agent = createSpaceAgent({ dataDir: spaceDir, config, env: this.env })
    this.agents.set(id, agent)
    return agent
  }

  /** 读取 space.json */
  private async readSpaceJson(id: string): Promise<SpaceInfo | null> {
    try {
      const content = await fs.readFile(
        path.join(this.dataDir, id, 'space.json'),
        'utf-8',
      )
      return JSON.parse(content) as SpaceInfo
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/space-manager.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/space/space-manager.ts packages/server/src/__tests__/space-manager.test.ts
git commit -m "feat(server): add SpaceManager — CRUD + lazy agent loading"
```

---

### Task 6: REST API Routes

**Files:**
- Create: `packages/server/src/api/routes.ts`
- Create: `packages/server/src/__tests__/routes.test.ts`

**Context:**
- Spec Section 3: REST API table
- Hono test client: `app.request(path, options)` or `new Hono().fetch()`
- SpaceManager: `packages/server/src/space/space-manager.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/src/__tests__/routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createRoutes } from '../api/routes'
import { SpaceManager } from '../space/space-manager'
import type { PresetConfig } from '../preset/preset-loader'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const mockPreset: PresetConfig = {
  dirName: 'example',
  name: 'Example',
  description: 'Test',
  systemPrompt: 'hi',
  forkProfiles: [],
  skills: [],
  llm: { model: 'claude-sonnet-4-20250514' },
  consolidatePrompt: null,
  integratePrompt: null,
}

describe('REST API', () => {
  let app: Hono
  let manager: SpaceManager

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'))
    manager = new SpaceManager(tmpDir, [mockPreset])
    const routes = createRoutes(manager, [mockPreset])
    app = new Hono()
    app.route('/api', routes)
  })

  describe('GET /api/presets', () => {
    it('returns preset list', async () => {
      const res = await app.request('/api/presets')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].dirName).toBe('example')
    })
  })

  describe('POST /api/spaces', () => {
    it('creates a space', async () => {
      const res = await app.request('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetName: 'example' }),
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.id).toBeDefined()
      expect(body.name).toBe('Example')
    })

    it('returns 400 for unknown preset', async () => {
      const res = await app.request('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetName: 'nonexistent' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/spaces', () => {
    it('lists spaces', async () => {
      await app.request('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetName: 'example' }),
      })
      const res = await app.request('/api/spaces')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
    })
  })

  describe('GET /api/spaces/:id', () => {
    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/api/spaces/nonexistent')
      expect(res.status).toBe(404)
    })

    it('returns space info', async () => {
      const createRes = await app.request('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetName: 'example' }),
      })
      const { id } = await createRes.json()
      const res = await app.request(`/api/spaces/${id}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe(id)
    })
  })

  describe('DELETE /api/spaces/:id', () => {
    it('deletes a space', async () => {
      const createRes = await app.request('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetName: 'example' }),
      })
      const { id } = await createRes.json()
      const res = await app.request(`/api/spaces/${id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)

      const getRes = await app.request(`/api/spaces/${id}`)
      expect(getRes.status).toBe(404)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/routes.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement routes.ts**

```typescript
// packages/server/src/api/routes.ts
import { Hono } from 'hono'
import type { SpaceManager } from '../space/space-manager'
import type { PresetConfig } from '../preset/preset-loader'

/** 创建 REST API 路由 */
export function createRoutes(manager: SpaceManager, presets: PresetConfig[]) {
  const api = new Hono()

  // ─── Presets ───

  api.get('/presets', (c) => {
    return c.json(presets.map(p => ({
      dirName: p.dirName,
      name: p.name,
      description: p.description,
      llm: p.llm,
    })))
  })

  // ─── Spaces CRUD ───

  api.get('/spaces', async (c) => {
    const spaces = await manager.listSpaces()
    return c.json(spaces)
  })

  api.post('/spaces', async (c) => {
    const body = await c.req.json<{ presetName: string }>()
    try {
      const space = await manager.createSpace(body.presetName)
      return c.json(space, 201)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  api.get('/spaces/:id', async (c) => {
    const space = await manager.getSpace(c.req.param('id'))
    if (!space) return c.json({ error: 'Space not found' }, 404)
    return c.json(space)
  })

  api.delete('/spaces/:id', async (c) => {
    try {
      await manager.deleteSpace(c.req.param('id'))
      return c.json({ ok: true })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404)
    }
  })

  // ─── Session tree (within a Space) ───

  api.get('/spaces/:id/tree', async (c) => {
    try {
      const agent = await manager.getAgent(c.req.param('id'))
      const tree = await agent.sessions.getTree()
      return c.json(tree)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404)
    }
  })

  api.get('/spaces/:id/sessions', async (c) => {
    try {
      const agent = await manager.getAgent(c.req.param('id'))
      const sessions = await agent.sessions.listAll()
      return c.json(sessions)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404)
    }
  })

  api.get('/spaces/:id/sessions/:sid', async (c) => {
    try {
      const agent = await manager.getAgent(c.req.param('id'))
      const sid = c.req.param('sid')
      const meta = await agent.sessions.get(sid)
      if (!meta) return c.json({ error: 'Session not found' }, 404)
      const records = await agent.memory.readRecords(sid)
      const l2 = await agent.memory.readMemory(sid)
      return c.json({ meta, records, l2 })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404)
    }
  })

  return api
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server exec vitest run src/__tests__/routes.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/api/routes.ts packages/server/src/__tests__/routes.test.ts
git commit -m "feat(server): add REST API routes"
```

---

### Task 7: WebSocket Handler

**Files:**
- Create: `packages/server/src/api/ws-handler.ts`

**Context:**
- Spec Section 4: WS protocol
- StelloAgent public API: `stello/packages/core/src/agent/stello-agent.ts` (lines 220-278)
- `agent.stream()` returns `Promise<EngineStreamResult>` where `EngineStreamResult extends AsyncIterable<string> & { result: Promise<EngineTurnResult> }`
- `agent.attachSession(sessionId, holderId)` / `agent.detachSession(sessionId, holderId)` for ref-counted lifecycle
- ws package: `WebSocket`, `WebSocketServer`

- [ ] **Step 1: Implement ws-handler.ts**

```typescript
// packages/server/src/api/ws-handler.ts
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { SpaceManager } from '../space/space-manager'
import type { StelloAgent } from '@stello-ai/core'

/** Client → Server 消息类型 */
type ClientMessage =
  | { type: 'session.enter'; sessionId: string }
  | { type: 'session.leave' }
  | { type: 'session.message'; input: string }
  | { type: 'session.stream'; input: string }
  | { type: 'session.fork'; label: string; scope?: string; profileName?: string }

/** 发送 JSON 消息到 WS 客户端 */
function send(ws: WebSocket, data: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

/** 发送错误消息 */
function sendError(ws: WebSocket, message: string, code: string) {
  send(ws, { type: 'error', message, code })
}

/** 创建 WS handler 并绑定到 HTTP server */
export function createWsHandler(server: Server, manager: SpaceManager) {
  const wss = new WebSocketServer({ noServer: true })

  // 拦截 HTTP upgrade 请求，从 URL 提取 spaceId
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', `http://${request.headers.host}`)
    const match = url.pathname.match(/^\/ws\/(.+)$/)
    if (!match) {
      socket.destroy()
      return
    }
    const spaceId = match[1]!
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, spaceId)
    })
  })

  wss.on('connection', (ws: WebSocket, spaceId: string) => {
    const holderId = randomUUID()
    let currentSessionId: string | null = null
    let agent: StelloAgent | null = null

    // 懒加载 agent
    const getAgent = async (): Promise<StelloAgent> => {
      if (!agent) {
        agent = await manager.getAgent(spaceId)
      }
      return agent
    }

    ws.on('message', async (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        sendError(ws, 'Invalid JSON', 'PARSE_ERROR')
        return
      }

      try {
        switch (msg.type) {
          case 'session.enter': {
            const a = await getAgent()
            await a.attachSession(msg.sessionId, holderId)
            const bootstrap = await a.enterSession(msg.sessionId)
            currentSessionId = msg.sessionId
            send(ws, { type: 'session.entered', sessionId: msg.sessionId, bootstrap })
            break
          }

          case 'session.leave': {
            if (!currentSessionId) {
              sendError(ws, 'No session entered', 'NOT_ENTERED')
              break
            }
            const a = await getAgent()
            await a.leaveSession(currentSessionId)
            await a.detachSession(currentSessionId, holderId)
            send(ws, { type: 'session.left', sessionId: currentSessionId })
            currentSessionId = null
            break
          }

          case 'session.message': {
            if (!currentSessionId) {
              sendError(ws, 'No session entered', 'NOT_ENTERED')
              break
            }
            const a = await getAgent()
            const result = await a.turn(currentSessionId, msg.input)
            send(ws, { type: 'turn.complete', result })
            break
          }

          case 'session.stream': {
            if (!currentSessionId) {
              sendError(ws, 'No session entered', 'NOT_ENTERED')
              break
            }
            const a = await getAgent()
            const streamResult = await a.stream(currentSessionId, msg.input)
            for await (const chunk of streamResult) {
              send(ws, { type: 'stream.delta', chunk })
            }
            const turnResult = await streamResult.result
            send(ws, { type: 'stream.end', result: turnResult })
            break
          }

          case 'session.fork': {
            if (!currentSessionId) {
              sendError(ws, 'No session entered', 'NOT_ENTERED')
              break
            }
            const a = await getAgent()
            const node = await a.forkSession(currentSessionId, {
              label: msg.label,
              scope: msg.scope,
            })
            send(ws, { type: 'session.forked', node })
            break
          }

          default:
            sendError(ws, `Unknown message type: ${(msg as { type: string }).type}`, 'UNKNOWN_TYPE')
        }
      } catch (e) {
        sendError(ws, (e as Error).message, 'HANDLER_ERROR')
      }
    })

    // 断开时自动 detach
    ws.on('close', async () => {
      if (currentSessionId && agent) {
        try {
          await agent.detachSession(currentSessionId, holderId)
        } catch {
          // 忽略 detach 错误
        }
      }
    })
  })

  return wss
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/api/ws-handler.ts
git commit -m "feat(server): add WebSocket handler — session interaction protocol"
```

---

### Task 8: Server Entry Point

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json` (add dotenv dependency)

**Context:**
- Spec Section 9: startup flow
- Current index.ts just exports `VERSION`

- [ ] **Step 1: Add dotenv dependency**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server add dotenv`

- [ ] **Step 2: Implement server entry point**

```typescript
// packages/server/src/index.ts
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import * as path from 'node:path'
import { loadPresets } from './preset/preset-loader'
import { SpaceManager } from './space/space-manager'
import { createRoutes } from './api/routes'
import { createWsHandler } from './api/ws-handler'

/** MindKit 本地服务入口 */
export const VERSION = '0.1.0'

async function main() {
  const port = Number(process.env['PORT'] ?? 3000)
  const dataDir = path.resolve(process.cwd(), 'data', 'spaces')
  const presetsDir = path.resolve(process.cwd(), 'market', 'presets')

  // 加载 presets
  const presets = await loadPresets(presetsDir)
  console.log(`Loaded ${presets.length} presets: ${presets.map(p => p.dirName).join(', ')}`)

  // 创建 SpaceManager
  const manager = new SpaceManager(dataDir, presets)

  // 创建 Hono app
  const app = new Hono()
  const routes = createRoutes(manager, presets)
  app.route('/api', routes)

  // 启动 HTTP server
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`MindKit server v${VERSION} listening on http://localhost:${info.port}`)
  })

  // 挂载 WS handler
  createWsHandler(server, manager)
}

main().catch((err) => {
  console.error('Failed to start MindKit server:', err)
  process.exit(1)
})
```

- [ ] **Step 3: Update tsup entry to also export modules**

The entry point runs the server when executed directly. For library use, also export the modules:

```typescript
// packages/server/src/index.ts — add at top (before main())
export { SpaceManager, type SpaceInfo } from './space/space-manager'
export { createSpaceAgent, type SpaceFactoryContext } from './space/space-factory'
export { loadPresets, type PresetConfig } from './preset/preset-loader'
export { resolveLLM, toLLMCallFn } from './llm/resolve-llm'
export { createRoutes } from './api/routes'
export { createWsHandler } from './api/ws-handler'
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd /home/i/Code/MindKit && pnpm --filter @stello-ai/session run build && pnpm --filter @stello-ai/core run build && pnpm --filter @mindkit/server run build`
Expected: Successful build

- [ ] **Step 5: Smoke test — start server**

Run: `cd /home/i/Code/MindKit && pnpm --filter @mindkit/server run dev`
Expected: `MindKit server v0.1.0 listening on http://localhost:3000` and `Loaded 1 presets: example`

Verify with curl:
```bash
curl http://localhost:3000/api/presets
# Should return: [{"dirName":"example","name":"Example Assistant",...}]
```

- [ ] **Step 6: Commit**

```bash
cd /home/i/Code/MindKit
git add packages/server/src/index.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): add server entry point — wires all modules"
```

---

### Task 9: Run Full Test Suite + Typecheck

**Files:** No new files — verification only.

- [ ] **Step 1: Run all MindKit tests**

Run: `cd /home/i/Code/MindKit && pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd /home/i/Code/MindKit && pnpm --filter @stello-ai/session run build && pnpm --filter @stello-ai/core run build && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Run Stello core tests (for FileSystemMemoryEngine)**

Run: `cd /home/i/Code/stello && pnpm --filter @stello-ai/core run test`
Expected: All tests pass including new FileSystemMemoryEngine tests

- [ ] **Step 4: Fix any issues found**

Address any test failures or type errors.

- [ ] **Step 5: Final commit if any fixes**

```bash
git commit -m "fix(server): address test/typecheck issues"
```
