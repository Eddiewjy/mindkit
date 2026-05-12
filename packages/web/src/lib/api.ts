import type { SpaceMeta, PresetConfig, SessionTreeNode, TurnRecord, TurnResult, SpaceEvent, SessionDetail } from './types'

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

/** 获取所有可用 preset（完整配置，供前端预填） */
export function fetchPresets(): Promise<PresetConfig[]> {
  return request('/presets')
}

/* ── Spaces ── */

export function fetchSpaces(): Promise<SpaceMeta[]> {
  return request('/spaces')
}

/** 创建 Space（body 中 preset 字段作为默认值，用户字段覆盖） */
export function createSpace(body: {
  name: string
  presetDirName: string
  emoji?: string
  color?: string
  description?: string
  mode?: 'AUTO' | 'PRO'
  expectedArtifacts?: string
  systemPrompt?: string
  consolidatePrompt?: string
  integratePrompt?: string
  presetSessions?: Array<{
    name: string; label: string
    systemPrompt?: string
    systemPromptMode?: 'preset' | 'prepend' | 'append'
    context?: 'none' | 'inherit'
    consolidatePrompt?: string
    guidePrompt?: string
    activationHint?: string; skills?: string[]
  }>
  skills?: Array<{ name: string; description: string; content: string }>
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

/* ── Session ── */

/** 进入 session（对齐 devtools，turn 前调用） */
export function enterSession(spaceId: string, sessionId: string): Promise<unknown> {
  return request(`/spaces/${spaceId}/sessions/${sessionId}/enter`, { method: 'POST' })
}

/* ── Chat ── */

/** 发送消息，返回完整 turn result（对齐 devtools response 格式） */
export function sendTurn(
  spaceId: string,
  sessionId: string,
  message: string,
): Promise<TurnResult> {
  return request(`/spaces/${spaceId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, message }),
  })
}

/* ── Session Records ── */

export function fetchRecords(
  spaceId: string,
  sessionId: string,
): Promise<{ records: TurnRecord[] }> {
  return request(`/spaces/${spaceId}/sessions/${sessionId}/records`)
}

/* ── Events ── */

export function fetchEvents(
  spaceId: string,
  limit = 100,
): Promise<{ events: SpaceEvent[] }> {
  return request(`/spaces/${spaceId}/events?limit=${limit}`)
}

/* ── Session Detail ── */

/** 获取 session 详情（L2/synthesis） */
export function fetchSessionDetail(
  spaceId: string,
  sessionId: string,
): Promise<SessionDetail> {
  return request(`/spaces/${spaceId}/sessions/${sessionId}/detail`)
}

/** 手动触发 consolidation */
export function triggerConsolidate(
  spaceId: string,
  sessionId: string,
): Promise<{ ok: true; l2: string }> {
  return request(`/spaces/${spaceId}/sessions/${sessionId}/consolidate`, { method: 'POST' })
}

/** 手动触发 integration */
export function triggerIntegrate(
  spaceId: string,
): Promise<{ ok: true; synthesis: string | null }> {
  return request(`/spaces/${spaceId}/integrate`, { method: 'POST' })
}
