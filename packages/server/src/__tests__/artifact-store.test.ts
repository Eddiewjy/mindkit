import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ArtifactStore } from '../artifacts/artifact-store'
import type { ArtifactDetail } from '../artifacts/artifact-store'

describe('ArtifactStore', () => {
  let dir: string
  let store: ArtifactStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-artifact-'))
    store = new ArtifactStore(dir)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('list returns empty when no artifacts', async () => {
    expect(await store.list()).toEqual([])
  })

  it('save and get round-trips artifact', async () => {
    const artifact: ArtifactDetail = {
      id: 'a1',
      title: 'PRD',
      type: 'markdown',
      content: '# Product Requirements',
      sourceNodeIds: ['root'],
      createdAt: '2026-04-08T00:00:00Z',
      updatedAt: '2026-04-08T00:00:00Z',
      editHistory: [],
    }
    await store.save(artifact)
    const loaded = await store.get('a1')
    expect(loaded).not.toBeNull()
    expect(loaded!.title).toBe('PRD')
    expect(loaded!.content).toBe('# Product Requirements')
  })

  it('list returns all artifact metas without content', async () => {
    await store.save({
      id: 'a1', title: 'PRD', type: 'markdown', content: '# PRD',
      sourceNodeIds: [], createdAt: '', updatedAt: '', editHistory: [],
    })
    await store.save({
      id: 'a2', title: 'Plan', type: 'markdown', content: '# Plan',
      sourceNodeIds: [], createdAt: '', updatedAt: '', editHistory: [],
    })
    const list = await store.list()
    expect(list).toHaveLength(2)
    // list should not contain content field
    expect((list[0] as unknown as Record<string, unknown>)['content']).toBeUndefined()
  })

  it('get returns null for non-existent artifact', async () => {
    expect(await store.get('nope')).toBeNull()
  })
})
