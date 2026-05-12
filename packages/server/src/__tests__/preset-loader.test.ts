import { describe, it, expect, beforeEach } from 'vitest'
import { loadPresets } from '../preset/preset-loader'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const validPreset = {
  name: 'Test',
  description: 'A test preset',
  systemPrompt: 'You are helpful.',
  forkProfiles: [],
  skills: [],
  consolidatePrompt: null,
  integratePrompt: null,
}

describe('loadPresets', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-'))
  })

  it('returns empty array for empty directory', async () => {
    expect(await loadPresets(tmpDir)).toEqual([])
  })

  it('loads a valid preset JSON file with correct dirName', async () => {
    fs.writeFileSync(path.join(tmpDir, 'my-preset.json'), JSON.stringify(validPreset))
    const presets = await loadPresets(tmpDir)
    expect(presets).toHaveLength(1)
    expect(presets[0]!.dirName).toBe('my-preset')
    expect(presets[0]!.name).toBe('Test')
  })

  it('skips non-JSON files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# hello')
    expect(await loadPresets(tmpDir)).toEqual([])
  })

  it('loads multiple preset files', async () => {
    for (const name of ['a', 'b', 'c']) {
      fs.writeFileSync(path.join(tmpDir, `${name}.json`), JSON.stringify({ ...validPreset, name }))
    }
    const presets = await loadPresets(tmpDir)
    expect(presets).toHaveLength(3)
  })

  it('skips directories', async () => {
    fs.mkdirSync(path.join(tmpDir, 'some-dir'))
    expect(await loadPresets(tmpDir)).toEqual([])
  })

  it('skips invalid JSON files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), 'not json')
    expect(await loadPresets(tmpDir)).toEqual([])
  })
})
