import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SpaceManager } from '../space/space-manager'
import { buildRoutes } from '../api/routes'
import type { PresetConfig } from '../preset/preset-loader'

/** 测试用最小 preset */
const TEST_PRESET: PresetConfig = {
  dirName: 'test-preset',
  name: 'Test',
  description: '',
  emoji: '🧠',
  color: '#6366f1',
  mode: 'AUTO',
  expectedArtifacts: '',
  systemPrompt: '',
  forkProfiles: [],
  skills: [],
  consolidatePrompt: null,
  integratePrompt: null,
}

describe('Routes V2', () => {
  let spacesDir: string
  let manager: SpaceManager
  let app: ReturnType<typeof buildRoutes>

  beforeEach(async () => {
    spacesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-routes-'))
    manager = new SpaceManager({ spacesDir, presets: [TEST_PRESET], env: {} })
    app = buildRoutes(manager)
  })

  afterEach(async () => {
    await fs.rm(spacesDir, { recursive: true, force: true })
  })

  it('PATCH /spaces/:id updates meta', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const res = await app.request(`/spaces/${meta.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', emoji: '🎯' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed')
    expect(body.emoji).toBe('🎯')
  })

  it('PATCH /spaces/:id returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(404)
  })

  it('GET /spaces/:id/events returns empty list initially', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const res = await app.request(`/spaces/${meta.id}/events`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
  })

  it('GET /spaces/:id/events returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown/events')
    expect(res.status).toBe(404)
  })

  it('GET /spaces/:id/artifacts returns empty list initially', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const res = await app.request(`/spaces/${meta.id}/artifacts`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.artifacts).toEqual([])
  })

  it('GET /spaces/:id/artifacts returns 404 for unknown space', async () => {
    const res = await app.request('/spaces/unknown/artifacts')
    expect(res.status).toBe(404)
  })

  it('GET /spaces/:id/artifacts/:aid returns 404 for unknown artifact', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const res = await app.request(`/spaces/${meta.id}/artifacts/no-such-id`)
    expect(res.status).toBe(404)
  })
})
