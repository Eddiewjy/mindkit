# Session Detail Panel - L2/Synthesis 展示

## 概述

为 MindKit 前端添加 Session 详情面板，展示各节点的 L2 摘要和 Main Session 的综合分析（synthesis），并支持手动触发 consolidation/integration。

## 需求

1. 点击拓扑图节点 → overlay 侧边面板展示该节点的 L2（前端显示为「摘要」）
2. Main Session 面板额外展示 synthesis（「综合分析」）和所有子节点 L2（纵向卡片列表）
3. 支持手动触发「立即提炼」（consolidate）和「立即综合」（integrate）
4. 数据只读展示，不可编辑

## 后端 API

### 三个新端点

```
GET  /api/spaces/:id/sessions/:sid/detail
POST /api/spaces/:id/sessions/:sid/consolidate
POST /api/spaces/:id/integrate
```

### detail 响应类型（discriminated union）

```typescript
// 子节点 — scope 即 Main Session 推送给该子节点的 insight
{ type: 'child', label: string, l2: string | null, insight: string | null }

// Main Session
{ type: 'main', synthesis: string | null, childL2s: Array<{ sessionId: string, label: string, l2: string | null }> }
```

**Root session 判断**：handler 通过 `agent.sessions.getRoot()` 获取根节点 ID，与请求的 `sid` 比对来确定响应类型。

### consolidate 端点

**成功**：`{ ok: true, l2: string }` — 等待 consolidation 完成后返回新 L2

**错误**：
- `400 { error: 'No consolidateFn configured' }` — agent 未配置 consolidateFn
- `400 { error: 'No records to consolidate' }` — 该 session 无 L3 记录

**编排路径**（对齐 devtools 模式）：
```
records = agent.memory.readRecords(sid)
currentMemory = agent.memory.readMemory(sid)
l2 = agent.config.session.consolidateFn(currentMemory, messages)
agent.memory.writeMemory(sid, l2)
```

### integrate 端点

**成功**：`{ ok: true, synthesis: string, insightCount: number }`

**错误**：
- `400 { error: 'Integration not configured' }` — agent 未配置 mainSessionResolver + integrateFn

**编排路径**：
```
mainSession = await agent.config.session.mainSessionResolver()
result = await mainSession.integrate(agent.config.session.integrateFn)
```
注意：`space-factory.ts` 中的 `mainSessionResolver` 已包装了 integrate 方法，会自动将 synthesis 和 insights 持久化到 MemoryEngine。

### 数据来源

通过 `StelloAgent` 的公开属性（无需修改 SpaceManager）：
- `agent.memory.readMemory(sessionId)` 读 L2 / synthesis
- `agent.memory.readScope(sessionId)` 读 insight
- `agent.sessions.getRoot()` 获取根节点（判断 main vs child）
- `agent.sessions.listAll()` 列出所有 session，遍历收集子节点 L2

## 前端

### 新组件：SessionDetailPanel

Overlay 在 TopologyCanvas 上方，固定宽度 ~360px，右侧浮动，半透明背景。

**状态**：
- `loading: boolean` — 请求中显示加载指示
- `error: string | null` — 请求失败显示错误信息
- `triggering: boolean` — 手动触发操作进行中，按钮禁用

**子节点视图**：
- 节点 label 作为标题
- 「摘要」区域：L2 内容（纯文本，或「暂无摘要」灰字占位）
- 「Insight」区域（可选）：Main Session 推送的 insight
- 「立即提炼」按钮（triggering 时禁用 + loading 状态）

**Main Session 视图**：
- 「综合分析」区域：synthesis 内容
- 「立即综合」按钮
- 「各节点摘要」区域：纵向卡片列表，每张卡片显示节点 label + L2 内容预览
- 卡片内容长时可展开/折叠

### 节点点击行为变更

- 单击 → 打开详情面板（同时选中该节点用于 ChatPanel）
- 双击 → 进入 session 对话（原有行为）

单击同时完成两件事：打开详情面板 AND 选中节点。这样 ChatPanel 的 active session 切换与原有行为一致，详情面板是额外的信息展示。

### 数据流

1. 用户点击拓扑节点 → KitWorkspace 设置 `selectedSessionId`（同时驱动 ChatPanel 和 DetailPanel）
2. SessionDetailPanel mount → 调用 `fetchSessionDetail(spaceId, sessionId)`，显示 loading
3. 请求成功 → 根据响应 `type` 字段渲染对应视图；失败 → 显示错误
4. 手动触发操作 → POST 请求（按钮禁用）→ 成功后重新 fetch detail 刷新
5. 点击 ✕ 或面板外 → 清空 selectedSessionId → 面板消失

## 文件变更清单

**后端（server）**：
- 新增 `packages/server/src/api/session-detail.ts` — detail/consolidate/integrate 三个 handler
- 修改 `packages/server/src/api/routes.ts` — 注册三个新路由

**前端（web）**：
- 新增 `packages/web/src/components/SessionDetailPanel.tsx` — 侧边面板组件
- 修改 `packages/web/src/lib/api.ts` — 新增 `fetchSessionDetail`、`triggerConsolidate`、`triggerIntegrate`
- 修改 `packages/web/src/lib/types.ts` — 新增 `SessionDetail` discriminated union 类型
- 修改 `packages/web/src/components/TopologyCanvas.tsx` — 节点点击改为单击详情/双击进入
- 修改 `packages/web/src/pages/KitWorkspace.tsx` — 管理 `selectedSessionId`，渲染面板

总计：2 个新文件，4 个修改文件。
