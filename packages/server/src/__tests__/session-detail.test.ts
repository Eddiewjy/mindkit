import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SpaceManager } from '../space/space-manager'
import { buildRoutes } from '../api/routes'
import type { PresetConfig } from '../preset/preset-loader'

const TEST_PRESET: PresetConfig = {
  dirName: 'test-preset',
  name: 'Test',
  description: '',
  emoji: '🧠',
  color: '#6366f1',
  mode: 'AUTO',
  expectedArtifacts: '',
  systemPrompt: 'test prompt',
  forkProfiles: [],
  skills: [],
  consolidatePrompt: null,
  integratePrompt: null,
}

/** 构建带 dummy API key 的 SpaceManager */
function createTestManager(spacesDir: string): SpaceManager {
  return new SpaceManager({
    spacesDir,
    presets: [TEST_PRESET],
    env: { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'http://localhost:1' },
  })
}

/** 等待根 session 创建完成（space-factory 中异步 fire-and-forget） */
async function waitForRoot(manager: SpaceManager, spaceId: string, meta: Parameters<typeof manager.getAgent>[1]): Promise<string> {
  const agent = manager.getAgent(spaceId, meta)
  for (let i = 0; i < 20; i++) {
    try {
      const root = await agent.sessions.getRoot()
      return root.id
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  throw new Error('Root session not created in time')
}

describe('Session Detail API', () => {
  let spacesDir: string
  let manager: SpaceManager
  let app: ReturnType<typeof buildRoutes>

  beforeEach(async () => {
    spacesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-detail-'))
    manager = createTestManager(spacesDir)
    app = buildRoutes(manager)
  })

  afterEach(async () => {
    await fs.rm(spacesDir, { recursive: true, force: true }).catch(() => {})
  })

  it('GET detail for main session returns type=main', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const rootId = await waitForRoot(manager, meta.id, meta)

    const res = await app.request(`/spaces/${meta.id}/sessions/${rootId}/detail`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.type).toBe('main')
    expect(body).toHaveProperty('synthesis')
    expect(body).toHaveProperty('childL2s')
    expect(Array.isArray(body.childL2s)).toBe(true)
  })

  it('GET detail returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown/sessions/any/detail')
    expect(res.status).toBe(404)
  })

  it('POST consolidate returns 400 when no records exist', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const rootId = await waitForRoot(manager, meta.id, meta)

    const res = await app.request(`/spaces/${meta.id}/sessions/${rootId}/consolidate`, {
      method: 'POST',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('No records')
  })

  it('POST consolidate returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown/sessions/any/consolidate', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('POST integrate returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown/integrate', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})
