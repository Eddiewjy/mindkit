import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Preset 配置（Kit Market 商品），字段与手动创建 Kit 对齐。
 * 每个 preset 是 presetsDir 下的一个 JSON 文件，如 hackathon-brainstorm.json。
 */
export interface PresetConfig {
  /** 文件名（不含扩展名，唯一标识，运行时填充） */
  dirName: string
  /** 显示名称 */
  name: string
  /** 简要描述 */
  description: string
  /** 图标 emoji */
  emoji: string
  /** 主题颜色 */
  color: string
  /** 空间模式：AUTO 自动分裂 / PRO 确认后分裂 */
  mode: 'AUTO' | 'PRO'
  /** 预期产物描述 */
  expectedArtifacts: string
  /** 领域特定的系统提示词（不含工具使用说明，由框架层自动追加） */
  systemPrompt: string
  /** 预注册的 fork profile 列表 */
  forkProfiles: Array<{
    name: string
    systemPrompt?: string
    systemPromptMode?: 'preset' | 'prepend' | 'append'
    context?: 'none' | 'inherit'
    /** 该 fork profile 专属的 L3→L2 consolidation 提示词 */
    consolidatePrompt?: string
    /** 子会话的第一条 assistant 开场消息 */
    prompt?: string
    skills?: string[]
  }>
  /** 技能列表 */
  skills: Array<{
    name: string
    description: string
    content: string
  }>
  /** 自定义 consolidation prompt（null 使用默认） */
  consolidatePrompt: string | null
  /** 自定义 integration prompt（null 使用默认） */
  integratePrompt: string | null
}

/** 扫描目录下所有 JSON 文件加载 preset */
export async function loadPresets(presetsDir: string): Promise<PresetConfig[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(presetsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const results: PresetConfig[] = []
  for (const entry of entries) {
    const name = String(entry.name)
    if (!entry.isFile() || !name.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(presetsDir, name), 'utf-8')
      const parsed = JSON.parse(raw) as Omit<PresetConfig, 'dirName'>
      const dirName = name.replace(/\.json$/, '')
      results.push({
        ...parsed,
        dirName,
        // 兼容旧格式：缺少字段时给默认值
        emoji: parsed.emoji ?? '🧠',
        color: parsed.color ?? '#6366f1',
        mode: parsed.mode ?? 'AUTO',
        expectedArtifacts: parsed.expectedArtifacts ?? '',
      })
    } catch {
      // 跳过无效文件
    }
  }
  return results
}
