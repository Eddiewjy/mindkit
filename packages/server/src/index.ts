import * as path from 'node:path'
import * as fs from 'node:fs'
import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { WebSocketServer } from 'ws'
import { loadPresets } from './preset/preset-loader'
import { SpaceManager } from './space/space-manager'
import { buildRoutes } from './api/routes'
import { handleWsConnection } from './api/ws-handler'

/** 从环境变量读取服务器配置 */
const PORT = Number(process.env['PORT'] ?? 3000)
const HOST = process.env['HOST'] ?? '0.0.0.0'

/** 数据目录：从仓库根向上两级定位（相对于 packages/server/src/index.ts） */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const SPACES_DIR = path.join(REPO_ROOT, 'data', 'spaces')
const PRESETS_DIR = path.join(REPO_ROOT, 'market', 'presets')
const WEB_DIST = path.join(REPO_ROOT, 'packages', 'web', 'dist')

/** 校验必须的环境变量（对齐 devtools：OPENAI_API_KEY） */
function validateEnv(): void {
  if (!process.env['OPENAI_API_KEY']) {
    console.error('[mindkit] ERROR: Missing OPENAI_API_KEY')
    console.error('  export OPENAI_BASE_URL=https://api.minimaxi.com/v1')
    console.error('  export OPENAI_API_KEY=your_key')
    console.error('  export OPENAI_MODEL=MiniMax-M2.7')
    process.exit(1)
  }
}

async function main(): Promise<void> {
  validateEnv()
  console.log(`[mindkit] LLM: ${process.env['OPENAI_MODEL'] ?? 'MiniMax-M2.7'} @ ${process.env['OPENAI_BASE_URL'] ?? 'https://api.minimaxi.com/v1'}`)

  // 加载 preset 列表
  const presets = await loadPresets(PRESETS_DIR)
  console.log(`[mindkit] loaded ${presets.length} preset(s)`)

  // 初始化 SpaceManager
  const spaceManager = new SpaceManager({
    spacesDir: SPACES_DIR,
    presets,
    env: process.env as Record<string, string | undefined>,
  })

  // 构建 Hono 应用
  const app = new Hono()
  app.route('/api', buildRoutes(spaceManager))

  // 生产环境：serve 前端静态文件
  if (fs.existsSync(WEB_DIST)) {
    console.log(`[mindkit] serving static files from ${WEB_DIST}`)
    app.use('*', serveStatic({ root: path.relative(process.cwd(), WEB_DIST) }))
    app.get('*', (c) => {
      const html = fs.readFileSync(path.join(WEB_DIST, 'index.html'), 'utf-8')
      return c.html(html)
    })
  }

  // 创建 HTTP 服务器（hono + node-server）
  const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[mindkit] HTTP listening on http://${info.address}:${info.port}`)
  })

  // 附加 WebSocket 服务器（共享同一端口）
  const wss = new WebSocketServer({ server: server as ReturnType<typeof createServer> })
  wss.on('connection', (ws, req) => {
    // URL 格式：/ws/spaces/:spaceId
    const url = req.url ?? ''
    const match = url.match(/^\/ws\/spaces\/([^/?#]+)/)
    if (!match) {
      ws.close()
      return
    }
    const spaceId = match[1]!
    handleWsConnection(ws, spaceId, spaceManager).catch((err) => {
      console.error('[mindkit] ws error:', err)
      ws.close()
    })
  })

  console.log(`[mindkit] WS ready at ws://${HOST}:${PORT}/ws/spaces/:spaceId`)
}

main().catch((err) => {
  console.error('[mindkit] startup error:', err)
  process.exit(1)
})
