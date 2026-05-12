import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** 产物摘要信息（列表用，不含 content） */
export interface ArtifactMeta {
  id: string
  title: string
  type: string
  summary?: string
  sourceNodeIds: string[]
  createdAt: string
  updatedAt: string
}

/** 产物完整详情 */
export interface ArtifactDetail extends ArtifactMeta {
  content: string
  editHistory: { at: string; summary: string }[]
}

/** 文件系统产物存储（Agent 写 + REST 读） */
export class ArtifactStore {
  private readonly dir: string

  constructor(spaceDir: string) {
    this.dir = path.join(spaceDir, 'artifacts')
  }

  /** 列出所有产物摘要 */
  async list(): Promise<ArtifactMeta[]> {
    let files: string[]
    try {
      files = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const metas: ArtifactMeta[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(this.dir, file), 'utf-8')
        const detail = JSON.parse(raw) as ArtifactDetail
        const { content: _, editHistory: __, ...meta } = detail
        metas.push(meta)
      } catch { /* skip malformed */ }
    }
    return metas
  }

  /** 获取单个产物完整内容 */
  async get(id: string): Promise<ArtifactDetail | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir, `${id}.json`), 'utf-8')
      return JSON.parse(raw) as ArtifactDetail
    } catch {
      return null
    }
  }

  /** 保存产物（Agent tool 调用） */
  async save(artifact: ArtifactDetail): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(
      path.join(this.dir, `${artifact.id}.json`),
      JSON.stringify(artifact, null, 2),
    )
  }
}
