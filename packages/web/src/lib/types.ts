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
  systemPrompt: string
  consolidatePrompt?: string
  integratePrompt?: string
  presetSessions?: PresetSession[]
  skills?: SpaceSkill[]
  /** preset 激活映射：profileName → sessionId */
  activatedPresets?: Record<string, string>
}

/** 预设节点 */
export interface PresetSession {
  name: string
  label: string
  systemPrompt?: string
  /** systemPrompt 合成策略 */
  systemPromptMode?: 'preset' | 'prepend' | 'append'
  /** 上下文继承策略 */
  context?: 'none' | 'inherit'
  /** 该节点专属的 L3→L2 consolidation 提示词 */
  consolidatePrompt?: string
  guidePrompt?: string
  activationHint?: string
  skills?: string[]
}

/** 技能定义 */
export interface SpaceSkill {
  name: string
  description: string
  content: string
}

/** ForkProfile（preset 中定义） */
export interface PresetForkProfile {
  name: string
  systemPrompt?: string
  systemPromptMode?: 'preset' | 'prepend' | 'append'
  context?: 'none' | 'inherit'
  consolidatePrompt?: string
  skills?: string[]
}

/** Preset 完整配置（Kit Market 商品） */
export interface PresetConfig {
  dirName: string
  name: string
  description: string
  emoji: string
  color: string
  mode: 'AUTO' | 'PRO'
  expectedArtifacts: string
  systemPrompt: string
  consolidatePrompt?: string
  integratePrompt?: string
  forkProfiles: PresetForkProfile[]
  skills: SpaceSkill[]
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

/** 扁平拓扑节点（TopologyCanvas 消费） */
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

/** L3 对话记录（含 tool 消息和 metadata） */
export interface TurnRecord {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: string
  metadata?: {
    toolCallId?: string
    toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
  } & Record<string, unknown>
}

/** Tool call 详情（turn 响应中） */
export interface ToolCallDetail {
  id: string
  name: string
  args: Record<string, unknown>
  success?: boolean
  data?: unknown
  error?: string | null
  duration?: number
}

/** Turn 响应（对齐 devtools TurnResult 格式） */
export interface TurnResult {
  turn: {
    finalContent: string | null
    rawResponse: string
    toolRoundCount: number
    toolCallsExecuted: number
    toolCalls?: ToolCallDetail[]
  }
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
