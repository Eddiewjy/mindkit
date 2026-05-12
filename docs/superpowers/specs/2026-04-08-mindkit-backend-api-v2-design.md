# MindKit 后端 API V2 设计

**日期**：2026-04-08  
**范围**：在现有 CRUD + Chat 基础上，补全黑客松 demo 所需的完整后端接口  
**背景**：对照 PRD 的 Kit Space / Kit Market 功能，梳理现有实现缺口并设计补充 API

---

## 一、现有实现

| 接口 | 说明 |
|------|------|
| `GET /api/presets` | 列出所有可用 preset |
| `GET /api/spaces` | 列出所有 Space |
| `POST /api/spaces` | 创建 Space（仅 name + presetDirName） |
| `GET /api/spaces/:id` | 获取 Space 元数据 |
| `DELETE /api/spaces/:id` | 删除 Space |
| `POST /api/spaces/:id/chat` | 单次同步对话 |
| `WS /ws/spaces/:spaceId` | 流式对话（streaming chat） |

**当前 SpaceMeta**：`{ id, name, presetDirName, createdAt }`

---

## 二、设计原则

- 黑客松 demo 优先：只设计 demo 必须的，Market 本轮只设计接口、不实现
- 产物由 Agent tool 写入，前端只读
- 事件流复用现有 WS 连接（Option A），不新开端口

---

## 三、SpaceMeta 字段扩展

```typescript
interface SpaceMeta {
  id: string
  name: string
  presetDirName: string
  createdAt: string

  // 显示元数据
  emoji: string              // 默认 '🧠'
  color: string              // 默认 '#6366f1'，用于卡片边框和节点着色
  description?: string
  mode: 'AUTO' | 'PRO'      // AUTO=AI 自动分裂，PRO=需用户确认，默认 AUTO
  expectedArtifacts?: string // 用户期望的交付物描述，写入 Agent 任务目标

  // Agent 行为配置
  presetSessions?: PresetSession[]   // 预设节点（底层注册为 ForkProfile）
  skills?: SpaceSkill[]              // 该 Space 可用的 skills
}
```

### PresetSession

预设节点配置，底层注册到 Stello `ForkProfileRegistry`：

```typescript
interface PresetSession {
  name: string            // 标识，底层注册为 ForkProfile name
  label: string           // 节点显示名称（如「竞品分析」）
  systemPrompt?: string   // 主题范围，注入子 session 的 system prompt
  guidePrompt?: string    // 用户进入节点时展示的引导语（开场问题）
  activationHint?: string // 提示 AI 何时应激活此节点（自然语言描述条件）
  skills?: string[]       // 该节点允许的 skills 白名单（undefined=继承全局）
}
```

### SpaceSkill

直接对应 Stello `Skill` 接口：

```typescript
interface SpaceSkill {
  name: string
  description: string   // LLM 据此判断是否调用 activate_skill
  content: string       // 激活时注入子 session 的完整 prompt
}
```

### SpaceFactory 集成

SpaceFactory 构建 Agent 时，将 `meta.presetSessions` 注册到 `ForkProfileRegistry`，`meta.skills` 注册到 `SkillRouter`，与 preset 提供的合并（Space 级配置覆盖 preset 级）。

---

## 四、Tier 1 — Demo 核心 API

### 4.1 创建 Space（扩展）

```
POST /api/spaces
```

**Request body**（新增字段）：

```typescript
{
  name: string
  presetDirName: string
  emoji?: string
  color?: string
  description?: string
  mode?: 'AUTO' | 'PRO'
  expectedArtifacts?: string
  presetSessions?: PresetSession[]
  skills?: SpaceSkill[]
}
```

**Response**：`201 SpaceMeta`

---

### 4.2 更新 Space 设置

```
PATCH /api/spaces/:id
```

**Request body**：

```typescript
Partial<Pick<SpaceMeta,
  'name' | 'emoji' | 'color' | 'description' |
  'mode' | 'expectedArtifacts' | 'presetSessions' | 'skills'
>>
```

**Response**：`200 SpaceMeta`

修改后即时生效，不影响已有对话历史和产物。

---

### 4.3 拓扑 API

```
GET /api/spaces/:id/topology
```

**Response**：

```typescript
{
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

interface TopologyNode {
  id: string             // sessionId
  label: string          // 节点显示名称
  parentId: string | null
  isActive: boolean      // false = 模板节点未激活
  messageCount: number
  summary?: string       // L2 摘要（consolidation 后更新）
}

interface TopologyEdge {
  sourceId: string
  targetId: string
  type: 'association' | 'contradiction'
  description?: string   // 关联/矛盾的具体说明，hover 展示
}
```

边由 Agent integration 产出后写入 Space 持久化存储。

---

### 4.4 产物 API（前端只读）

产物由 Agent 通过 tool 调用创建和更新，REST 接口仅供前端读取。

```
GET /api/spaces/:id/artifacts
```

**Response**：

```typescript
{
  artifacts: ArtifactMeta[]
}

interface ArtifactMeta {
  id: string
  title: string
  type: string               // 'prd' | 'plan' | 'markdown' 等
  summary?: string
  sourceNodeIds: string[]    // 来源节点
  createdAt: string
  updatedAt: string
}
```

---

```
GET /api/spaces/:id/artifacts/:artifactId
```

**Response**：

```typescript
interface ArtifactDetail extends ArtifactMeta {
  content: string            // markdown 内容（demo 阶段只支持 markdown）
  editHistory: {
    at: string               // ISO8601
    summary: string          // 本次修改说明
  }[]
}
```

---

### 4.5 WS 协议扩展（Option A：复用现有连接）

在现有 `/ws/spaces/:spaceId` 基础上，**新增服务端推送类型**：

```typescript
// 现有（不变）
| { type: 'chunk'; content: string }
| { type: 'done'; sessionId: string }
| { type: 'error'; message: string }

// 新增
| { type: 'space_event'; event: SpaceEvent }
```

**SpaceEvent 结构**：

```typescript
interface SpaceEvent {
  id: string
  at: string           // ISO8601
  kind: SpaceEventKind
  payload: Record<string, unknown>
}

type SpaceEventKind =
  | 'node_forked'            // 节点分裂，payload: { nodeId, label, parentId }
  | 'memory_consolidated'    // L3→L2 提炼，payload: { nodeId }
  | 'global_integrated'      // 主节点整合，payload: { round: number }
  | 'insight_pushed'         // 洞察推送，payload: { targetNodeId, insight }
  | 'association_found'      // 关联发现，payload: { sourceId, targetId, description }
  | 'contradiction_detected' // 矛盾检测，payload: { sourceId, targetId, description }
  | 'artifact_created'       // 产物创建，payload: { artifactId, title, type }
  | 'artifact_updated'       // 产物更新，payload: { artifactId, summary }
  | 'node_activated'         // 模板节点激活，payload: { nodeId, label }
```

**实现参考 devtools**：每个 Space 维护独立 EventBus，WS 连接建立时订阅，Agent hooks（`onSessionFork`、`onRoundEnd` 等）触发事件广播。

**REST 历史查询**：

```
GET /api/spaces/:id/events?limit=100
```

**Response**：`{ events: SpaceEvent[] }`，内存维护，不持久化（与 devtools 一致）。

---

## 五、Tier 2 — Kit Market（本轮只设计，不实现）

### 5.1 浏览广场

```
GET /api/market/kits?category=&q=&page=1&pageSize=20
```

**Response**：

```typescript
{
  kits: MarketKitSummary[]
  total: number
}

interface MarketKitSummary {
  id: string
  name: string
  description: string
  emoji: string
  authorId: string
  authorName: string
  nodeCount: number          // 预设节点数
  expectedArtifacts?: string
  forkCount: number
  rating: number             // 1-5
  publishedAt: string
}
```

---

### 5.2 Kit 详情

```
GET /api/market/kits/:id
```

**Response**：

```typescript
interface MarketKitDetail extends MarketKitSummary {
  // 预设节点缩略结构（只读预览）
  presetNodes: {
    name: string
    topicScope?: string
    guidePrompt?: string
    parentName?: string | null
  }[]
  reviews: {
    userId: string
    rating: number
    comment?: string
    createdAt: string
  }[]
}
```

---

### 5.3 Fork Kit

```
POST /api/market/kits/:id/fork
```

**Request body**：`{ name?: string }` （可修改 Kit 名称，默认沿用原名）

**Response**：`201 SpaceMeta`

**Fork 逻辑**：
1. 复制模板的 `presetSessions`、`skills`、Agent 配置到新 Space
2. 所有预设节点（TopologyNode）初始状态 `isActive: false`
3. 新 Space 的 `meta.json` 记录来源 `forkedFrom: marketKitId`

---

### 5.4 发布到 Market

```
POST /api/market/kits
```

**Request body**：

```typescript
{
  spaceId: string        // 从哪个 Space 发布
  description: string
  category: string
  // 可选隐藏高级配置（默认公开节点结构）
  exposeAgentConfig?: boolean
}
```

**Response**：`201 MarketKitSummary`

---

## 六、接口汇总

| 层级 | 接口 | 状态 |
|------|------|------|
| **Tier 1** | `POST /api/spaces`（扩展） | 待实现 |
| **Tier 1** | `PATCH /api/spaces/:id` | 待实现 |
| **Tier 1** | `GET /api/spaces/:id/topology` | 待实现 |
| **Tier 1** | `GET /api/spaces/:id/artifacts` | 待实现 |
| **Tier 1** | `GET /api/spaces/:id/artifacts/:id` | 待实现 |
| **Tier 1** | `GET /api/spaces/:id/events` | 待实现 |
| **Tier 1** | WS `space_event` 推送扩展 | 待实现 |
| **Tier 2** | `GET /api/market/kits` | 设计完成，暂不实现 |
| **Tier 2** | `GET /api/market/kits/:id` | 设计完成，暂不实现 |
| **Tier 2** | `POST /api/market/kits/:id/fork` | 设计完成，暂不实现 |
| **Tier 2** | `POST /api/market/kits` | 设计完成，暂不实现 |
| **已有** | `GET /api/presets` | 已实现 |
| **已有** | `GET/DELETE /api/spaces` 系列 | 已实现 |
| **已有** | `POST /api/spaces/:id/chat` | 已实现 |
| **已有** | `WS /ws/spaces/:spaceId` | 已实现（待扩展） |
