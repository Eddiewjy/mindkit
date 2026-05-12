import { Hono } from 'hono'
import type { SpaceManager, SpaceMeta, SpaceUpdatePatch, SpaceCreateBody } from '../space/space-manager'
import { registerSessionDetailRoutes } from './session-detail'

/** 构建 REST API 路由，注入 SpaceManager */
export function buildRoutes(spaceManager: SpaceManager): Hono {
  const app = new Hono()

  /** GET /presets — 列出所有可用 preset（返回完整配置供前端预填） */
  app.get('/presets', (c) => {
    const presets = spaceManager.getPresets()
    const list = presets.map((p) => ({
      dirName: p.dirName,
      name: p.name,
      description: p.description,
      emoji: p.emoji,
      color: p.color,
      mode: p.mode,
      expectedArtifacts: p.expectedArtifacts,
      systemPrompt: p.systemPrompt,
      forkProfiles: p.forkProfiles,
      skills: p.skills,
    }))
    return c.json(list)
  })

  /** GET /spaces — 列出所有 Space */
  app.get('/spaces', async (c) => {
    const spaces = await spaceManager.listSpaces()
    return c.json(spaces)
  })

  /** POST /spaces — 创建新 Space（从 preset 合并默认值） */
  app.post('/spaces', async (c) => {
    const body = await c.req.json<SpaceCreateBody>()
    if (!body.name || !body.presetDirName) {
      return c.json({ error: 'name and presetDirName are required' }, 400)
    }
    try {
      const meta = await spaceManager.createSpace(body)
      return c.json(meta, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 400)
    }
  })

  /** GET /spaces/:id — 获取 Space 详情 */
  app.get('/spaces/:id', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    return c.json(meta)
  })

  /** DELETE /spaces/:id — 删除 Space */
  app.delete('/spaces/:id', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    await spaceManager.deleteSpace(id)
    return c.json({ ok: true })
  })

  /** POST /spaces/:id/chat — 单次同步对话（仿 devtools turn 端点，返回 tool call 详情） */
  app.post('/spaces/:id/chat', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)

    const body = await c.req.json<{ message?: string; sessionId?: string }>()
    if (!body.message) return c.json({ error: 'message is required' }, 400)
    if (!body.sessionId) return c.json({ error: 'sessionId is required' }, 400)

    const agent = spaceManager.getAgent(id, meta)
    const toolCallTimers = new Map<string, number>()
    const toolCalls: Array<{
      id: string; name: string; args: Record<string, unknown>
      success?: boolean; data?: unknown; error?: string | null; duration?: number
    }> = []

    const result = await agent.turn(body.sessionId, body.message, {
      onToolCall: (toolCall) => {
        const callId = toolCall.id ?? toolCall.name
        toolCallTimers.set(callId, Date.now())
        toolCalls.push({ id: callId, name: toolCall.name, args: toolCall.args })
      },
      onToolResult: (toolResult) => {
        const callId = toolResult.toolCallId ?? toolResult.toolName
        const startTime = toolCallTimers.get(callId)
        const duration = startTime ? Date.now() - startTime : undefined
        toolCallTimers.delete(callId)
        const target = toolCalls.find((tc) => tc.id === callId)
        if (!target) return
        target.success = toolResult.success
        target.data = toolResult.data
        target.error = toolResult.error
        target.duration = duration
      },
    })

    // 返回完整 result 对象（对齐 devtools response 格式）
    const response = toolCalls.length > 0
      ? { ...result, turn: { ...result.turn, toolCalls } }
      : result
    return c.json(response)
  })

  /** POST /spaces/:id/sessions/:sid/enter — 进入 session（对齐 devtools） */
  app.post('/spaces/:id/sessions/:sid/enter', async (c) => {
    const id = c.req.param('id')
    const sid = c.req.param('sid')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    const agent = spaceManager.getAgent(id, meta)
    try {
      const result = await agent.enterSession(sid)
      return c.json(result)
    } catch {
      return c.json({ ok: true })
    }
  })

  /** PATCH /spaces/:id — 更新 Space 设置 */
  app.patch('/spaces/:id', async (c) => {
    const id = c.req.param('id')
    const patch = await c.req.json<SpaceUpdatePatch>()
    const updated = await spaceManager.updateSpace(id, patch)
    if (!updated) return c.json({ error: 'Space not found' }, 404)
    return c.json(updated)
  })

  /** GET /spaces/:id/topology — 获取拓扑树 */
  app.get('/spaces/:id/topology', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    const agent = spaceManager.getAgent(id, meta)
    try {
      const tree = await agent.sessions.getTree()
      return c.json(tree)
    } catch {
      // 根 session 尚未创建（首次对话前），返回空树
      return c.json({ id: '', label: 'Main', status: 'active', turnCount: 0, children: [] })
    }
  })

  /** GET /spaces/:id/artifacts — 产物列表 */
  app.get('/spaces/:id/artifacts', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    const store = spaceManager.getArtifactStore(id)
    const artifacts = await store.list()
    return c.json({ artifacts })
  })

  /** GET /spaces/:id/artifacts/:aid — 产物详情 */
  app.get('/spaces/:id/artifacts/:aid', async (c) => {
    const id = c.req.param('id')
    const aid = c.req.param('aid')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    const store = spaceManager.getArtifactStore(id)
    const artifact = await store.get(aid)
    if (!artifact) return c.json({ error: 'Artifact not found' }, 404)
    return c.json(artifact)
  })

  /** GET /spaces/:id/events — 事件历史 */
  app.get('/spaces/:id/events', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    const limit = Number(c.req.query('limit') ?? 100)
    const bus = spaceManager.getEventBus(id)
    const events = bus.getHistory().slice(-limit)
    return c.json({ events })
  })

  /** GET /spaces/:id/sessions/:sid/records — 获取 session 对话记录 */
  app.get('/spaces/:id/sessions/:sid/records', async (c) => {
    const id = c.req.param('id')
    const sid = c.req.param('sid')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)
    const agent = spaceManager.getAgent(id, meta)
    try {
      const records = await agent.memory.readRecords(sid)
      return c.json({
        records: records.map((r) => ({
          role: r.role,
          content: r.content,
          timestamp: r.timestamp,
          metadata: r.metadata,
        })),
      })
    } catch {
      return c.json({ records: [] })
    }
  })

  // Session detail / consolidate / integrate
  registerSessionDetailRoutes(app, spaceManager)

  return app
}

/** 从路由中提取 SpaceMeta helper（供 ws-handler 复用） */
export async function resolveSpaceMeta(
  spaceManager: SpaceManager,
  spaceId: string,
): Promise<SpaceMeta | null> {
  return spaceManager.getSpace(spaceId)
}
