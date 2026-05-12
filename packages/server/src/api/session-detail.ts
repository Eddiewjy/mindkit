import type { Hono } from 'hono'
import type { SpaceManager } from '../space/space-manager'

/** 注册 session detail 相关路由 */
export function registerSessionDetailRoutes(app: Hono, spaceManager: SpaceManager): void {
  /** GET /spaces/:id/sessions/:sid/detail — 获取 session 的 L2/synthesis 详情 */
  app.get('/spaces/:id/sessions/:sid/detail', async (c) => {
    const id = c.req.param('id')
    const sid = c.req.param('sid')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)

    const agent = spaceManager.getAgent(id, meta)
    let root: { id: string }
    try {
      root = await agent.sessions.getRoot()
    } catch {
      // 根 session 尚未创建，当前 sid 一定不是 main
      root = { id: '' }
    }
    const isMain = root.id === sid

    if (isMain) {
      const synthesis = await agent.memory.readMemory(sid).catch(() => null)
      const allSessions = await agent.sessions.listAll()
      const childSessions = allSessions.filter((s) => s.id !== root.id)
      const childL2s = await Promise.all(
        childSessions.map(async (s) => ({
          sessionId: s.id,
          label: s.label,
          l2: await agent.memory.readMemory(s.id).catch(() => null),
        })),
      )
      return c.json({ type: 'main' as const, synthesis, childL2s })
    }

    const sessionMeta = await agent.sessions.get(sid)
    const label = sessionMeta?.label ?? sid
    const l2 = await agent.memory.readMemory(sid).catch(() => null)
    const insight = await agent.memory.readScope(sid).catch(() => null)
    return c.json({ type: 'child' as const, label, l2, insight })
  })

  /** POST /spaces/:id/sessions/:sid/consolidate — 手动触发 L3→L2 提炼 */
  app.post('/spaces/:id/sessions/:sid/consolidate', async (c) => {
    const id = c.req.param('id')
    const sid = c.req.param('sid')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)

    const agent = spaceManager.getAgent(id, meta)
    const consolidateFn = agent.config.session?.consolidateFn
    if (!consolidateFn) {
      return c.json({ error: 'No consolidateFn configured' }, 400)
    }

    const records = await agent.memory.readRecords(sid)
    if (records.length === 0) {
      return c.json({ error: 'No records to consolidate' }, 400)
    }

    const currentMemory = await agent.memory.readMemory(sid).catch(() => null)
    const messages = records.map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp }))
    const l2 = await consolidateFn(currentMemory, messages)
    await agent.memory.writeMemory(sid, l2)
    return c.json({ ok: true, l2 })
  })

  /** POST /spaces/:id/integrate — 手动触发 integration */
  app.post('/spaces/:id/integrate', async (c) => {
    const id = c.req.param('id')
    const meta = await spaceManager.getSpace(id)
    if (!meta) return c.json({ error: 'Space not found' }, 404)

    const agent = spaceManager.getAgent(id, meta)
    const mainSessionResolver = agent.config.session?.mainSessionResolver
    const integrateFn = agent.config.session?.integrateFn
    if (!mainSessionResolver || !integrateFn) {
      return c.json({ error: 'Integration not configured' }, 400)
    }

    try {
      const mainSession = await mainSessionResolver()
      if (!mainSession) return c.json({ error: 'Main session not available' }, 400)
      await mainSession.integrate(integrateFn)
      const root = await agent.sessions.getRoot()
      const synthesis = await agent.memory.readMemory(root.id).catch(() => null)
      return c.json({ ok: true, synthesis })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 500)
    }
  })
}
