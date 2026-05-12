# MindKit Backend Implementation Design

> **Goal:** 实现 MindKit 本地后端——多 Space 管理、REST/WS API、文件系统持久化，基于 Stello SDK。

---

## 1. 模块划分

```
packages/server/src/
├── llm/
│   └── resolve-llm.ts           # model 名 → stello adapter 工厂路由 + LLMCallFn 包装
├── space/
│   ├── space-manager.ts         # Space CRUD + 懒加载 StelloAgent
│   └── space-factory.ts         # preset config → StelloAgentConfig（含 capabilities 构建）
├── api/
│   ├── routes.ts                # Hono REST 路由
│   └── ws-handler.ts            # WebSocket 处理
├── preset/
│   └── preset-loader.ts         # 扫描 market/presets/ 目录
└── index.ts                     # 入口：组装 + 启动 Hono server
```

**依赖方向（单向）：**
```
index.ts → api/ → space/ → llm/
                         → preset/
```

**Stello 依赖（仅两个包，无额外外部依赖）：**
- `@stello-ai/core`：
  - 已有：`createStelloAgent`, `SessionTreeImpl`, `NodeFileSystemAdapter`, `ForkProfileRegistryImpl`, `SkillRouterImpl`, `ToolRegistryImpl`, `Scheduler`, `createDefaultConsolidateFn`, `createDefaultIntegrateFn`
  - **新增**：`FileSystemMemoryEngine`（需在 Stello core 中实现，见 Section 5）
- `@stello-ai/session`：`createClaude`, `createGPT`, `createSession`, `loadSession`, `createMainSession`, `loadMainSession`

Anthropic/OpenAI SDK 由 session 包传递引入，MindKit 不直接依赖。

---

## 2. Space 管理

### 2.1 数据结构

每个 Space 持久化在 `data/spaces/{spaceId}/` 下：

```
data/spaces/{spaceId}/           # NodeFileSystemAdapter base path
├── space.json                   # Space 元信息
├── config.json                  # Preset 配置快照
├── core.json                    # L1 核心档案（MemoryEngine 管理）
└── sessions/                    # SessionTreeImpl + FileSystemMemoryEngine 共享
    └── {sessionId}/
        ├── meta.json            # SessionTreeImpl 管理
        ├── memory.md            # FileSystemMemoryEngine: L2 摘要
        ├── scope.md             # FileSystemMemoryEngine: L2 scope
        ├── index.md             # FileSystemMemoryEngine: L2 index
        └── records.jsonl        # FileSystemMemoryEngine: L3 对话记录
```

**space.json 结构：**
```typescript
interface SpaceInfo {
  id: string
  name: string              // 来自 preset name
  presetName: string        // 关联的 preset 目录名
  createdAt: string         // ISO 8601
  updatedAt: string
}
```

**config.json** — 创建 Space 时从 preset.json 复制的完整配置快照。SpaceFactory 重建 agent 时读取此文件而非再找 preset 目录（preset 可能已变更）。

### 2.2 SpaceManager

Space CRUD + StelloAgent 懒加载：

- `listSpaces()` — 扫描 `data/spaces/` 下所有 `space.json`，返回 `SpaceInfo[]`
- `getSpace(id)` — 读 `space.json`，返回 `SpaceInfo | null`
- `createSpace(presetName)` — 生成 UUID，从 preset 复制 config.json，写 space.json，创建 sessions/ 目录
- `deleteSpace(id)` — 删除整个 `data/spaces/{id}/` 目录，清除缓存。如有活跃 WS 连接则拒绝（返回 409）
- `getAgent(id)` — 懒加载：缓存命中直接返回，否则调用 SpaceFactory 构建 StelloAgent 并缓存

**懒加载策略：**
- 持有 `Map<string, StelloAgent>` 缓存
- 首次 `getAgent(id)` 时实例化
- 暂不实现 idle 回收（YAGNI）

### 2.3 SpaceFactory

将 config.json + space info 组装为完整 `StelloAgentConfig`。参考 `demo/stello-agent-chat/chat-devtools.ts` 的 agent 构建模式。

**构建步骤：**

1. **存储层：**
   - `NodeFileSystemAdapter(data/spaces/{id}/)` → fs（base = Space 根目录，SessionTreeImpl 内部用 `sessions/` 前缀）
   - `SessionTreeImpl(fs)` → sessions
   - `FileSystemMemoryEngine(fs, sessions)` → memory（注入 sessions 用于 assembleContext 祖先链遍历）
   - `InMemoryStorageAdapter` → sessionStorage（session 组件的运行时存储，启动时从 MemoryEngine 恢复 L3/L2/scope）

2. **LLM：**
   - `resolveLLM(config.llm.model, env)` → 主 LLM adapter
   - 从 adapter 包装 `LLMCallFn`（用于 consolidation/integration）

3. **Capabilities 构建：**

   **lifecycle: EngineLifecycleAdapter**
   ```typescript
   {
     bootstrap: async (sessionId) => ({
       context: await memory.assembleContext(sessionId),
       session: await sessions.get(sessionId),
     }),
     afterTurn: async (sessionId, userMsg, assistantMsg) => {
       // 追加 L3 记录
       await memory.appendRecord(sessionId, userMsg)
       await memory.appendRecord(sessionId, assistantMsg)
       // 更新 turnCount
       const current = await sessions.get(sessionId)
       await sessions.updateMeta(sessionId, { turnCount: current.turnCount + 1 })
       return { coreUpdated: false, memoryUpdated: false, recordAppended: true }
     },
   }
   ```

   **tools: EngineToolRuntime** — 初始无自定义工具，只提供空实现。内置 tool（stello_create_session 等）由 Engine 自动管理。
   ```typescript
   {
     getToolDefinitions: () => [],
     executeTool: async () => ({ success: false, error: 'no custom tools' }),
   }
   ```

   **skills: SkillRouter** — 从 config.skills 注册
   ```typescript
   const skillRouter = new SkillRouterImpl()
   for (const skill of config.skills) {
     skillRouter.register(skill)  // { name, description, content }
   }
   ```

   **confirm: ConfirmProtocol** — 自动批准 split（本地产品无需用户确认），dismiss update
   ```typescript
   {
     confirmSplit: async (proposal) => {
       return lifecycle.prepareChildSpawn({
         parentId: proposal.parentId,
         label: proposal.suggestedLabel,
         scope: proposal.suggestedScope,
       })
     },
     dismissSplit: async () => {},
     confirmUpdate: async () => {},
     dismissUpdate: async () => {},
   }
   ```

   **profiles: ForkProfileRegistry** — 从 config.forkProfiles 注册

4. **Session 接入（`session` config）：**
   - `sessionResolver` — 先将 MemoryEngine 中的 L3/L2/scope 恢复到 `InMemoryStorageAdapter`，再调用 `loadSession(sessionId, { storage, llm, tools })` 加载 session
   - `mainSessionResolver` — 同样恢复后调用 `loadMainSession(rootId, { storage, llm, tools })`，返回包装对象将 integration 结果同步回 MemoryEngine
   - `consolidateFn` — 使用 core 已有的 `createDefaultConsolidateFn(prompt, llmCallFn)`（prompt 来自 config.consolidatePrompt，缺省用 `DEFAULT_CONSOLIDATE_PROMPT`）
   - `integrateFn` — 使用 core 已有的 `createDefaultIntegrateFn(prompt, llmCallFn)`（prompt 来自 config.integratePrompt，缺省用 `DEFAULT_INTEGRATE_PROMPT`）

5. **编排（`orchestration` config）：**
   - `scheduler` — 默认 `new Scheduler({ consolidation: { trigger: 'everyNTurns', everyNTurns: 3 }, integration: { trigger: 'afterConsolidate' } })`
   - `hooks` — `onRoundEnd` 中调用 `lifecycle.afterTurn()` 同步 L3 记录

6. 调用 `createStelloAgent(config)` 返回 agent 实例

---

## 3. HTTP REST API

面向终端用户的精简 API，不需要 devtools 的配置修改能力。

### Space 管理

| Method | Path | 说明 | 错误 |
|--------|------|------|------|
| GET | `/api/spaces` | 列出所有 Space 元信息 | - |
| POST | `/api/spaces` | 创建 Space（body: `{ presetName }`） | 400: preset 不存在 |
| GET | `/api/spaces/:id` | 获取 Space 详情 | 404: Space 不存在 |
| DELETE | `/api/spaces/:id` | 删除 Space | 404: 不存在; 409: 有活跃连接 |

### Preset

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/presets` | 列出所有可用 preset |

### Session 树（Space 内）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/spaces/:id/tree` | 完整 session 树 |
| GET | `/api/spaces/:id/sessions` | 所有 session 元信息 |
| GET | `/api/spaces/:id/sessions/:sid` | 单个 session 详情（meta + L3 records + L2） |

交互式操作（turn、stream、fork）全走 WebSocket。

---

## 4. WebSocket 协议

### 连接

端点：`ws://localhost:{port}/ws/{spaceId}`

连接建立时，SpaceManager 懒加载该 Space 的 StelloAgent。一个 WS 连接绑定一个 Space，同时跟踪当前 entered 的 session。每个 WS 连接获得唯一 holderId（UUID），用于 `attachSession` / `detachSession` 的引用计数。多个连接可以同时连接同一 Space（StelloAgent 通过 holderId 管理并发）。

### Client → Server

```typescript
| { type: 'session.enter'; sessionId: string }
| { type: 'session.leave' }
| { type: 'session.message'; input: string }
| { type: 'session.stream'; input: string }
| { type: 'session.fork'; label: string; scope?: string; profileName?: string }
```

`session.fork` 从当前 entered 的 session fork。`profileName` 可选，指定预注册的 ForkProfile。

### Server → Client

```typescript
| { type: 'session.entered'; sessionId: string; bootstrap: BootstrapResult }
| { type: 'session.left'; sessionId: string }
| { type: 'turn.complete'; result: EngineTurnResult }
| { type: 'stream.delta'; chunk: string }
| { type: 'stream.end'; result: EngineTurnResult }
| { type: 'session.forked'; node: SessionTreeNode }
| { type: 'error'; message: string; code: string }
```

**注意：** `stream.end` 的 result 是 `EngineTurnResult`（不是 `EngineStreamResult`）。WS handler 消费 `agent.stream()` 返回的 AsyncIterable，逐 chunk 发 `stream.delta`，流结束后 await `.result` 得到 `EngineTurnResult` 发送。

### 连接生命周期

- `session.enter` → 调用 `agent.attachSession(sessionId, holderId)` + `agent.enterSession(sessionId)`
- `session.leave` → 调用 `agent.leaveSession(sessionId)` + `agent.detachSession(sessionId, holderId)`
- `session.message` / `session.stream` / `session.fork` 需要先 `session.enter`，否则返回 `NOT_ENTERED` 错误
- 断开连接时自动 `detachSession`（如果有 entered session）
- 错误 code：`PARSE_ERROR` / `NOT_ENTERED` / `UNKNOWN_TYPE` / `HANDLER_ERROR`

---

## 5. FileSystemMemoryEngine（Stello core 新增）

**这是一个需要在 Stello core 中新建的组件。** 实现 `MemoryEngine` 接口，基于 `NodeFileSystemAdapter`。

**放置位置：** `stello/packages/core/src/memory/file-system-memory-engine.ts`

**构造函数：**
```typescript
constructor(fs: FileSystemAdapter, sessions: SessionTree)
```
注入 `SessionTree` 用于 `assembleContext` 的祖先链遍历（`sessions.getAncestors(sessionId)` → 依次读各祖先的 memory）。

**数据布局与 SessionTreeImpl 共享同一 FileSystemAdapter，使用 `sessions/` 前缀：**

```
basePath/                        # = data/spaces/{spaceId}/
├── core.json                    # L1 core profile（根级别）
└── sessions/                    # 与 SessionTreeImpl 共享目录
    └── {sessionId}/
        ├── meta.json            # SessionTreeImpl 管理
        ├── memory.md            # L2 摘要
        ├── scope.md             # L2 scope
        ├── index.md             # L2 index
        └── records.jsonl        # L3 对话记录
```

**接口实现：**

| 方法 | 存储文件 | 说明 |
|------|---------|------|
| `readCore(path?)` / `writeCore(path, value)` | `core.json` | dot-path 支持（get/set nested） |
| `readMemory` / `writeMemory` | `{sid}/memory.md` | L2 摘要 |
| `readScope` / `writeScope` | `{sid}/scope.md` | L2 scope |
| `readIndex` / `writeIndex` | `{sid}/index.md` | L2 index |
| `appendRecord` / `readRecords` | `{sid}/records.jsonl` | L3 JSONL |
| `replaceRecords` | `{sid}/records.jsonl` | 重写整个文件（压缩后替换） |
| `assembleContext(sessionId)` | 多文件 | core + `sessions.getAncestors()` 遍历祖先 memory + 当前 memory + scope |

MindKit 通过 `workspace:^` 引用，直接改 Stello submodule。

---

## 6. ConsolidateFn / IntegrateFn

**不需要 MindKit 自己的工厂函数。** Stello core 已提供：
- `createDefaultConsolidateFn(prompt, llmCallFn)` → `SessionCompatibleConsolidateFn`
- `createDefaultIntegrateFn(prompt, llmCallFn)` → `SessionCompatibleIntegrateFn`
- `DEFAULT_CONSOLIDATE_PROMPT` / `DEFAULT_INTEGRATE_PROMPT` 默认提示词

**位置：** `stello/packages/core/src/llm/defaults.ts`

SpaceFactory 只需：
1. 从 config.json 读 `consolidatePrompt` / `integratePrompt`（null 则用默认值）
2. 将 LLM adapter 包装为 `LLMCallFn`：`(messages) => adapter.complete(messages).then(r => r.content!)`
3. 调用 `createDefaultConsolidateFn(prompt, llmCallFn)` / `createDefaultIntegrateFn(prompt, llmCallFn)`

---

## 7. LLM 路由

**放置位置：** `packages/server/src/llm/resolve-llm.ts`

**`resolveLLM(model: string, env: Record<string, string>): LLMAdapter`**

按 model 前缀路由：
- `claude-*` → `createClaude({ model, apiKey: env.ANTHROPIC_API_KEY })`
- `gpt-*` / `o3-*` / `o4-*` → `createGPT({ model, apiKey: env.OPENAI_API_KEY })`
- 其他 → 抛错

**`toLLMCallFn(adapter: LLMAdapter): LLMCallFn`**

将 `LLMAdapter` 包装为 `LLMCallFn`（`core/src/llm/defaults.ts` 使用的简化接口）：
```typescript
(messages) => adapter.complete(messages.map(m => ({ role: m.role, content: m.content }))).then(r => r.content!)
```

API key 从环境变量读取，不存入 config。

---

## 8. Preset 加载

**放置位置：** `packages/server/src/preset/preset-loader.ts`

**`loadPresets(presetsDir: string): PresetConfig[]`**

扫描 `market/presets/` 下每个子目录的 `preset.json`，返回解析后的配置列表。

**PresetConfig 结构：**
```typescript
interface PresetConfig {
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
```

---

## 9. 入口

**`packages/server/src/index.ts`**

启动流程：
1. 加载 `.env` 环境变量
2. `loadPresets('market/presets/')` 加载所有 preset
3. 创建 `SpaceManager(dataDir, presets)`
4. 创建 Hono app，挂载 REST 路由
5. 创建 HTTP server（`@hono/node-server`）
6. 创建 WS server（`ws`），挂载 WS handler
7. 监听端口（默认 3000）

---

## 设计决策总结

1. 直接调用 StelloAgent，不复用 devtools
2. FileSystemMemoryEngine 放 Stello core 包（新建，注入 SessionTree 用于祖先遍历）
3. WS 按 URL 路径 `/ws/{spaceId}` 绑定 Space，每连接唯一 holderId
4. LLM 用 session 包已有 adapter（createClaude/createGPT），无额外依赖
5. REST 做查询/管理，WS 做交互
6. SpaceManager 懒加载 + Map 缓存，暂不实现 idle 回收
7. ConsolidateFn/IntegrateFn 直接复用 core 的 `createDefaultConsolidateFn`/`createDefaultIntegrateFn`
8. capabilities 完整构建：lifecycle（bootstrap+afterTurn）, tools（空实现，内置 tool 由 Engine 管理）, skills, confirm（自动批准 split）, profiles
9. Space 持久化 config.json（preset 快照），重启后从此重建 agent
10. 删除 Space 时若有活跃 WS 连接则拒绝（409）
