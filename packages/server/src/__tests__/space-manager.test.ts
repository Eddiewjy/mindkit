import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as spaceFactory from '../space/space-factory'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SpaceManager } from '../space/space-manager'
import type { PresetConfig } from '../preset/preset-loader'

/** 测试用最小 preset */
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

/** 创建临时目录，测试后清理 */
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mindkit-test-'))
}

describe('SpaceManager', () => {
  let spacesDir: string
  let manager: SpaceManager

  beforeEach(async () => {
    spacesDir = await makeTmpDir()
    manager = new SpaceManager({
      spacesDir,
      presets: [TEST_PRESET],
      env: {},
    })
  })

  afterEach(async () => {
    await fs.rm(spacesDir, { recursive: true, force: true })
  })

  describe('listSpaces', () => {
    it('returns empty array when spacesDir is empty', async () => {
      const spaces = await manager.listSpaces()
      expect(spaces).toEqual([])
    })

    it('returns empty array when spacesDir does not exist', async () => {
      const m = new SpaceManager({
        spacesDir: path.join(spacesDir, 'nonexistent'),
        presets: [TEST_PRESET],
        env: {},
      })
      const spaces = await m.listSpaces()
      expect(spaces).toEqual([])
    })

    it('returns created spaces', async () => {
      await manager.createSpace({ name: 'My Space', presetDirName: 'test-preset' })
      const spaces = await manager.listSpaces()
      expect(spaces).toHaveLength(1)
      expect(spaces[0]!.name).toBe('My Space')
      expect(spaces[0]!.presetDirName).toBe('test-preset')
    })

    it('skips directories without valid meta.json', async () => {
      // 创建一个没有 meta.json 的目录
      await fs.mkdir(path.join(spacesDir, 'bogus-dir'))
      const spaces = await manager.listSpaces()
      expect(spaces).toHaveLength(0)
    })
  })

  describe('createSpace', () => {
    it('creates space and returns meta with id and createdAt', async () => {
      const meta = await manager.createSpace({ name: 'Test Space', presetDirName: 'test-preset' })
      expect(meta.id).toBeDefined()
      expect(meta.name).toBe('Test Space')
      expect(meta.presetDirName).toBe('test-preset')
      expect(meta.createdAt).toBeDefined()
    })

    it('writes meta.json to the space directory', async () => {
      const meta = await manager.createSpace({ name: 'Test Space', presetDirName: 'test-preset' })
      const raw = await fs.readFile(
        path.join(spacesDir, meta.id, 'meta.json'),
        'utf-8',
      )
      const parsed = JSON.parse(raw)
      expect(parsed.id).toBe(meta.id)
      expect(parsed.name).toBe('Test Space')
    })

    it('throws if presetDirName is unknown', async () => {
      await expect(manager.createSpace({ name: 'X', presetDirName: 'unknown-preset' })).rejects.toThrow(
        'Preset not found: unknown-preset',
      )
    })

    it('creates unique ids for multiple spaces', async () => {
      const a = await manager.createSpace({ name: 'A', presetDirName: 'test-preset' })
      const b = await manager.createSpace({ name: 'B', presetDirName: 'test-preset' })
      expect(a.id).not.toBe(b.id)
    })
  })

  describe('getSpace', () => {
    it('returns meta for existing space', async () => {
      const created = await manager.createSpace({ name: 'X', presetDirName: 'test-preset' })
      const found = await manager.getSpace(created.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })

    it('returns null for non-existent space', async () => {
      const result = await manager.getSpace('does-not-exist')
      expect(result).toBeNull()
    })
  })

  describe('deleteSpace', () => {
    it('removes the space directory', async () => {
      const meta = await manager.createSpace({ name: 'D', presetDirName: 'test-preset' })
      await manager.deleteSpace(meta.id)
      const exists = await fs
        .access(path.join(spacesDir, meta.id))
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    })

    it('space no longer appears in listSpaces after deletion', async () => {
      const meta = await manager.createSpace({ name: 'D', presetDirName: 'test-preset' })
      await manager.deleteSpace(meta.id)
      const spaces = await manager.listSpaces()
      expect(spaces.find((s) => s.id === meta.id)).toBeUndefined()
    })

    it('does not throw if space does not exist', async () => {
      await expect(manager.deleteSpace('nonexistent')).resolves.not.toThrow()
    })
  })

  describe('recordPresetActivation', () => {
    it('records profileName → sessionId mapping in meta', async () => {
      const meta = await manager.createSpace({ name: 'Test', presetDirName: 'test-preset' })
      await manager.recordPresetActivation(meta.id, 'idea-deep-dive', 'session-123')

      const updated = await manager.getSpace(meta.id)
      expect(updated!.activatedPresets).toEqual({ 'idea-deep-dive': 'session-123' })
    })

    it('preserves existing activations when adding new ones', async () => {
      const meta = await manager.createSpace({ name: 'Test', presetDirName: 'test-preset' })
      await manager.recordPresetActivation(meta.id, 'a', 'session-1')
      await manager.recordPresetActivation(meta.id, 'b', 'session-2')

      const updated = await manager.getSpace(meta.id)
      expect(updated!.activatedPresets).toEqual({ a: 'session-1', b: 'session-2' })
    })

    it('does nothing if space does not exist', async () => {
      await manager.recordPresetActivation('nonexistent', 'a', 'session-1')
    })
  })

  describe('getAgent', () => {
    it('throws if preset is unknown', async () => {
      const meta = await manager.createSpace({ name: 'X', presetDirName: 'test-preset' })
      // 篡改 presetDirName 使缓存未命中
      const badMeta = { ...meta, presetDirName: 'unknown' }
      expect(() => manager.getAgent(meta.id, badMeta)).toThrow('Preset not found: unknown')
    })

    it('returns the same object on second call (caching)', async () => {
      const fakeAgent = { __fake: true } as never
      const spy = vi
        .spyOn(spaceFactory, 'createSpaceAgent')
        .mockReturnValue(fakeAgent)

      const meta = await manager.createSpace({ name: 'X', presetDirName: 'test-preset' })
      const agent1 = manager.getAgent(meta.id, meta)
      const agent2 = manager.getAgent(meta.id, meta)

      expect(agent1).toBe(fakeAgent)
      expect(agent1).toBe(agent2)
      // createSpaceAgent 只应被调用一次（第二次命中缓存）
      expect(spy).toHaveBeenCalledTimes(1)

      spy.mockRestore()
    })
  })
})
