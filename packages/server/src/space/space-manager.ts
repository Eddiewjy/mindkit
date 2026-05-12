import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { StelloAgent } from '@stello-ai/core'
import type { PresetConfig } from '../preset/preset-loader'
import { createSpaceAgent } from './space-factory'
import { EventBus } from '../events/event-bus'
import { ArtifactStore } from '../artifacts/artifact-store'

/** Space 元数据，存储在 space 数据目录下的 meta.json */
export interface SpaceMeta {
  id: string
  name: string
  /** 来源 preset 标识（可为空表示手动创建） */
  presetDirName: string
  createdAt: string
  emoji: string
  color: string
  description?: string
  mode: 'AUTO' | 'PRO'
  expectedArtifacts?: string
  /** 领域特定系统提示词（不含框架级 tool 说明） */
  systemPrompt: string
  /** 自定义 consolidation 提示词（null 使用默认） */
  consolidatePrompt?: string
  /** 自定义 integration 提示词（null 使用默认） */
  integratePrompt?: string
  /** 预设节点（注册为 ForkProfile） */
  presetSessions?: PresetSession[]
  /** 技能列表 */
  skills?: SpaceSkill[]
  /** preset 激活映射：profileName → sessionId */
  activatedPresets?: Record<string, string>
}

/** createSpace 的请求体 */
export interface SpaceCreateBody {
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
  presetSessions?: PresetSession[]
  skills?: SpaceSkill[]
}

/** 预设节点（底层注册为 ForkProfile） */
export interface PresetSession {
  name: string
  label: string
  systemPrompt?: string
  /** systemPrompt 合成策略：preset/prepend/append，默认 prepend */
  systemPromptMode?: 'preset' | 'prepend' | 'append'
  /** 上下文继承策略：none/inherit，默认 inherit */
  context?: 'none' | 'inherit'
  /** 该节点专属的 L3→L2 consolidation 提示词（覆盖 space 级别） */
  consolidatePrompt?: string
  guidePrompt?: string
  activationHint?: string
  skills?: string[]
}

/** Space 级别的技能定义 */
export interface SpaceSkill {
  name: string
  description: string
  content: string
}

/** updateSpace 可修改的字段子集 */
export type SpaceUpdatePatch = Partial<Pick<SpaceMeta,
  'name' | 'emoji' | 'color' | 'description' | 'mode' |
  'expectedArtifacts' | 'systemPrompt' | 'consolidatePrompt' | 'integratePrompt' |
  'presetSessions' | 'skills'
>>

/** SpaceManager 初始化配置 */
export interface SpaceManagerOptions {
  /** 所有 Space 数据目录的根路径（如 data/spaces） */
  spacesDir: string
  /** 可用的 preset 列表 */
  presets: PresetConfig[]
  /** 环境变量（API key 等） */
  env: Record<string, string | undefined>
}

/** Space CRUD + 懒加载 StelloAgent 缓存 */
export class SpaceManager {
  private readonly spacesDir: string
  private readonly presets: Map<string, PresetConfig>
  private readonly env: Record<string, string | undefined>
  /** 懒加载缓存：spaceId → StelloAgent */
  private readonly agents: Map<string, StelloAgent> = new Map()
  /** 懒加载缓存：spaceId → EventBus */
  private readonly eventBuses: Map<string, EventBus> = new Map()

  constructor(opts: SpaceManagerOptions) {
    this.spacesDir = opts.spacesDir
    this.env = opts.env
    this.presets = new Map(opts.presets.map((p) => [p.dirName, p]))
  }

  /** 获取所有可用 preset */
  getPresets(): PresetConfig[] {
    return [...this.presets.values()]
  }

  /** 列出所有已创建的 Space 元数据 */
  async listSpaces(): Promise<SpaceMeta[]> {
    let names: string[]
    try {
      const entries = await fs.readdir(this.spacesDir, { withFileTypes: true })
      names = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }

    const results: SpaceMeta[] = []
    for (const name of names) {
      const meta = await this.readMeta(name).catch(() => null)
      if (meta) results.push(meta)
    }
    return results
  }

  /** 创建新 Space：从 preset 合并默认值，用户字段覆盖 */
  async createSpace(body: SpaceCreateBody): Promise<SpaceMeta> {
    const preset = this.presets.get(body.presetDirName)
    if (!preset) {
      throw new Error(`Preset not found: ${body.presetDirName}`)
    }

    const id = crypto.randomUUID()
    const spaceDir = path.join(this.spacesDir, id)
    await fs.mkdir(spaceDir, { recursive: true })

    // preset 提供默认值，用户传入的字段覆盖
    const meta: SpaceMeta = {
      id,
      name: body.name,
      presetDirName: body.presetDirName,
      createdAt: new Date().toISOString(),
      emoji: body.emoji ?? preset.emoji,
      color: body.color ?? preset.color,
      mode: body.mode ?? preset.mode,
      systemPrompt: body.systemPrompt ?? preset.systemPrompt,
      ...(body.consolidatePrompt !== undefined
        ? { consolidatePrompt: body.consolidatePrompt }
        : preset.consolidatePrompt ? { consolidatePrompt: preset.consolidatePrompt } : {}),
      ...(body.integratePrompt !== undefined
        ? { integratePrompt: body.integratePrompt }
        : preset.integratePrompt ? { integratePrompt: preset.integratePrompt } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : preset.description ? { description: preset.description } : {}),
      ...((body.expectedArtifacts ?? preset.expectedArtifacts)
        ? { expectedArtifacts: body.expectedArtifacts ?? preset.expectedArtifacts }
        : {}),
      // skills/forkProfiles: 用户传入则用用户的，否则用 preset 的
      ...(body.presetSessions !== undefined
        ? { presetSessions: body.presetSessions }
        : preset.forkProfiles.length > 0
          ? { presetSessions: preset.forkProfiles.map((fp) => ({
              name: fp.name,
              label: fp.name,
              systemPrompt: fp.systemPrompt,
              systemPromptMode: fp.systemPromptMode,
              context: fp.context,
              consolidatePrompt: fp.consolidatePrompt,
              skills: fp.skills,
            })) }
          : {}),
      ...(body.skills !== undefined
        ? { skills: body.skills }
        : preset.skills.length > 0
          ? { skills: preset.skills }
          : {}),
    }
    await fs.writeFile(
      path.join(spaceDir, 'meta.json'),
      JSON.stringify(meta, null, 2),
    )
    return meta
  }

  /** 获取 Space 元数据 */
  async getSpace(id: string): Promise<SpaceMeta | null> {
    return this.readMeta(id).catch(() => null)
  }

  /** 部分更新 Space 元数据，返回更新后的 meta；不存在时返回 null */
  async updateSpace(id: string, patch: SpaceUpdatePatch): Promise<SpaceMeta | null> {
    const existing = await this.getSpace(id)
    if (!existing) return null

    const updated: SpaceMeta = { ...existing, ...patch }
    const spaceDir = path.join(this.spacesDir, id)
    await fs.writeFile(
      path.join(spaceDir, 'meta.json'),
      JSON.stringify(updated, null, 2),
    )
    // 清除 agent 缓存（配置已变更）
    this.agents.delete(id)
    return updated
  }

  /** 删除 Space：清除缓存并递归删除数据目录 */
  async deleteSpace(id: string): Promise<void> {
    this.agents.delete(id)
    this.eventBuses.delete(id)
    const spaceDir = path.join(this.spacesDir, id)
    await fs.rm(spaceDir, { recursive: true, force: true })
  }

  /** 获取或创建 Space 对应的 StelloAgent（懒加载，单例缓存） */
  getAgent(id: string, meta: SpaceMeta): StelloAgent {
    const cached = this.agents.get(id)
    if (cached) return cached

    const preset = this.presets.get(meta.presetDirName)
    if (!preset) throw new Error(`Preset not found: ${meta.presetDirName}`)

    const agent = createSpaceAgent({
      dataDir: path.join(this.spacesDir, id),
      config: preset,
      env: this.env,
      spaceMeta: meta,
      eventBus: this.getEventBus(id),
      onPresetActivated: (profileName, sessionId) => {
        this.recordPresetActivation(id, profileName, sessionId).catch(() => {})
      },
    })
    this.agents.set(id, agent)
    return agent
  }

  /** 获取 Space 的 EventBus（懒创建） */
  getEventBus(spaceId: string): EventBus {
    let bus = this.eventBuses.get(spaceId)
    if (!bus) {
      bus = new EventBus()
      this.eventBuses.set(spaceId, bus)
    }
    return bus
  }

  /** 获取 Space 的 ArtifactStore */
  getArtifactStore(spaceId: string): ArtifactStore {
    return new ArtifactStore(path.join(this.spacesDir, spaceId))
  }

  /** 记录 preset 被激活（内部方法，不暴露为 API） */
  async recordPresetActivation(spaceId: string, profileName: string, sessionId: string): Promise<void> {
    const meta = await this.readMeta(spaceId).catch(() => null)
    if (!meta) return

    const activated = meta.activatedPresets ?? {}
    activated[profileName] = sessionId
    meta.activatedPresets = activated

    const metaPath = path.join(this.spacesDir, spaceId, 'meta.json')
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2))
  }

  /** 读取指定 spaceId 的 meta.json */
  private async readMeta(spaceId: string): Promise<SpaceMeta> {
    const metaPath = path.join(this.spacesDir, spaceId, 'meta.json')
    const raw = await fs.readFile(metaPath, 'utf-8')
    return JSON.parse(raw) as SpaceMeta
  }
}
