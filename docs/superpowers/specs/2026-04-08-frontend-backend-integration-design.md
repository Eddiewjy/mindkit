# 前端接入真实后端 + Session 分裂跑通

**日期**：2026-04-08
**范围**：前端从 localStorage 切换到真实后端 API，丰富创建 Kit 配置，跑通 session 分裂 e2e
**定位**：前端是后端功能验证工具，不追求精细 UI

---

## 一、后端补充

### 1.1 Session Records 端点

```
GET /api/spaces/:id/sessions/:sessionId/records
→ { records: { role: string; content: string; timestamp: string }[] }
```

实现：`agent.memory.readRecords(sessionId)`，返回 L3 对话记录。

### 1.2 EventBus 接入 Engine Hooks

在 SpaceFactory 构建 Agent 时，通过 Engine hooks 将关键事件写入 EventBus：

- `onSessionFork` → emit `node_forked` 事件
- consolidation 完成后 → emit `memory_consolidated` 事件
- integration 完成后 → emit `global_integrated` 事件

需要 SpaceFactory 接收 EventBus 引用（通过 SpaceFactoryContext 传入）。

---

## 二、前端 API 客户端

新建 `packages/web/src/lib/api.ts`，封装所有后端调用：

```typescript
const BASE = '/api'

// Space CRUD
fetchSpaces(): Promise<SpaceMeta[]>
createSpace(body): Promise<SpaceMeta>
deleteSpace(id): Promise<void>
updateSpace(id, patch): Promise<SpaceMeta>

// Presets
fetchPresets(): Promise<PresetSummary[]>

// 对话（同步 REST，仿 devtools）
sendTurn(spaceId, sessionId, message): Promise<{ content: string; sessionId: string }>

// Session 记录
fetchRecords(spaceId, sessionId): Promise<{ records: Record[] }>

// 拓扑
fetchTopology(spaceId): Promise<SessionTreeNode>

// 产物
fetchArtifacts(spaceId): Promise<{ artifacts: ArtifactMeta[] }>
fetchArtifact(spaceId, aid): Promise<ArtifactDetail>

// 事件历史
fetchEvents(spaceId): Promise<{ events: SpaceEvent[] }>
```

Vite dev server 通过 proxy 转发 `/api` 和 `/ws` 到后端 `localhost:3000`。

---

## 三、WS 事件监听

在 KitWorkspace 组件内建立 WS 连接 `/ws/spaces/:spaceId`：

- 监听 `space_event` 类型消息
- `node_forked` → 重新 fetchTopology，拓扑图新增节点
- `artifact_created` / `artifact_updated` → 刷新产物列表（后续视图用）
- 断开自动重连

不使用 WS 传输对话内容，对话走 REST POST。

---

## 四、删除全局 Store

删除 `packages/web/src/lib/store.tsx`，各页面组件自行管理数据：

- SpaceList：`useState` + `useEffect` 拉 fetchSpaces
- KitWorkspace：拉 topology + 管理 selectedSessionId + WS 连接
- ChatPanel：拉 records + sendTurn

不再需要 useReducer / localStorage / Context。

---

## 五、创建 Kit 配置

CreateKitModal 改为功能验证优先：

- Preset 下拉（`GET /api/presets` 拉取）
- Name 输入
- Mode 切换（AUTO/PRO）
- 高级配置 JSON textarea：直接编辑 `{ emoji, color, description, expectedArtifacts, presetSessions, skills }`
- 提交时合并到 `POST /api/spaces` body

---

## 六、对话面板

仿 devtools 模式：

1. 用户输入 → `POST /api/spaces/:id/chat` body: `{ sessionId, message }`
2. 显示 loading spinner
3. 响应返回 → 渲染 assistant 消息（`response.content`）
4. Session 切换 → 拓扑节点点击 → 切换 sessionId → fetchRecords 拉历史
5. 历史消息从 records 端点加载，格式 `{ role, content, timestamp }`

---

## 七、Session 分裂 E2E 链路

```
用户在主节点对话
  → POST /spaces/:id/chat { sessionId: rootId, message }
  → Agent turn() 执行 → LLM 调用 stello_create_session tool
  → Engine executeCreateSession → confirmSplit 自动批准
  → 新 session 创建 + TopologyNode 写入
  → Engine hook onSessionFork → EventBus emit node_forked
  → WS 推送 { type: 'space_event', event: { kind: 'node_forked', ... } }
  → 前端收到 → fetchTopology 刷新 → 新节点出现在拓扑图
  → 用户点击新节点 → fetchRecords → 可以继续对话
```

---

## 八、文件变更汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/src/api/routes.ts` | Modify | 新增 GET sessions/:sid/records 端点 |
| `server/src/space/space-factory.ts` | Modify | Engine hooks 接入 EventBus |
| `server/src/space/space-manager.ts` | Modify | getAgent 时传入 EventBus |
| `web/src/lib/api.ts` | Create | 后端 API 客户端 |
| `web/src/lib/store.tsx` | Delete | 删除 localStorage store |
| `web/src/lib/types.ts` | Modify | 对齐后端类型 |
| `web/src/pages/SpaceList.tsx` | Modify | 接入真实 API |
| `web/src/pages/KitWorkspace.tsx` | Modify | 接入 topology API + WS |
| `web/src/components/ChatPanel.tsx` | Modify | 接入 REST chat + records |
| `web/vite.config.ts` | Modify | 添加 proxy 配置 |
