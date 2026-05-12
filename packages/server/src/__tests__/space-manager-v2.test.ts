import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SpaceManager } from '../space/space-manager'
import type { PresetConfig } from '../preset/preset-loader'

const TEST_PRESET: PresetConfig = {
  dirName: 'test-preset',
  name: 'Test Preset',
  description: 'A test preset',
  emoji: '🧠',
  color: '#6366f1',
  mode: 'AUTO',
  expectedArtifacts: '',
  systemPrompt: 'You are a test assistant.',
  forkProfiles: [],
  skills: [],
  consolidatePrompt: null,
  integratePrompt: null,
}

describe('SpaceMeta V2 fields', () => {
  let spacesDir: string
  let manager: SpaceManager

  beforeEach(async () => {
    spacesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-test-'))
    manager = new SpaceManager({ spacesDir, presets: [TEST_PRESET], env: {} })
  })

  afterEach(async () => {
    await fs.rm(spacesDir, { recursive: true, force: true })
  })

  it('createSpace accepts extended fields', async () => {
    const meta = await manager.createSpace({
      name: 'Kit',
      presetDirName: 'test-preset',
      emoji: '🚀',
      color: '#ff0000',
      description: 'A hackathon kit',
      mode: 'PRO',
      expectedArtifacts: 'PRD and tech spec',
    })
    expect(meta.emoji).toBe('🚀')
    expect(meta.color).toBe('#ff0000')
    expect(meta.description).toBe('A hackathon kit')
    expect(meta.mode).toBe('PRO')
    expect(meta.expectedArtifacts).toBe('PRD and tech spec')
  })

  it('createSpace uses defaults for omitted fields', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    expect(meta.emoji).toBe('🧠')
    expect(meta.color).toBe('#6366f1')
    expect(meta.mode).toBe('AUTO')
    // preset.description = 'A test preset'，createSpace 从 preset 合并默认值
    expect(meta.description).toBe('A test preset')
  })

  it('updateSpace patches specific fields', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    const updated = await manager.updateSpace(meta.id, {
      name: 'Renamed Kit',
      emoji: '🎯',
      mode: 'PRO',
    })
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('Renamed Kit')
    expect(updated!.emoji).toBe('🎯')
    expect(updated!.mode).toBe('PRO')
    expect(updated!.color).toBe('#6366f1')
    expect(updated!.createdAt).toBe(meta.createdAt)
  })

  it('updateSpace returns null for non-existent space', async () => {
    const result = await manager.updateSpace('no-such-id', { name: 'X' })
    expect(result).toBeNull()
  })

  it('updateSpace persists changes to meta.json', async () => {
    const meta = await manager.createSpace({ name: 'Kit', presetDirName: 'test-preset' })
    await manager.updateSpace(meta.id, { description: 'Updated' })
    const reloaded = await manager.getSpace(meta.id)
    expect(reloaded!.description).toBe('Updated')
  })
})
