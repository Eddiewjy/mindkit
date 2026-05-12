import type { WebSocket } from 'ws'
import type { SpaceEvent } from '../events/event-bus'
import type { SpaceManager } from '../space/space-manager'

/** 客户端发来的 WS 消息格式 */
interface WsInMessage {
  type: 'chat'
  sessionId: string
  message: string
}

/** 服务端发往客户端的 WS 消息格式 */
type WsOutMessage =
  | { type: 'chunk'; content: string }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'space_event'; event: SpaceEvent }

/** 安全发送 JSON 消息到 WebSocket */
function send(ws: WebSocket, msg: WsOutMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

/** 处理单个 WebSocket 连接，绑定到指定 Space */
export async function handleWsConnection(
  ws: WebSocket,
  spaceId: string,
  spaceManager: SpaceManager,
): Promise<void> {
  const meta = await spaceManager.getSpace(spaceId)
  if (!meta) {
    send(ws, { type: 'error', message: `Space not found: ${spaceId}` })
    ws.close()
    return
  }

  const agent = spaceManager.getAgent(spaceId, meta)

  // 订阅 EventBus，推送系统事件
  const bus = spaceManager.getEventBus(spaceId)
  const eventListener = (event: SpaceEvent) => {
    send(ws, { type: 'space_event', event })
  }
  bus.on(eventListener)

  ws.on('close', () => {
    bus.off(eventListener)
  })

  ws.on('message', (data) => {
    void (async () => {
      let msg: WsInMessage
      try {
        msg = JSON.parse(data.toString()) as WsInMessage
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' })
        return
      }

      if (msg.type !== 'chat' || !msg.sessionId || !msg.message) {
        send(ws, { type: 'error', message: 'type, sessionId and message are required' })
        return
      }

      try {
        // 流式发送增量 chunk
        const stream = await agent.stream(msg.sessionId, msg.message)
        for await (const chunk of stream) {
          send(ws, { type: 'chunk', content: chunk })
        }
        send(ws, { type: 'done', sessionId: msg.sessionId })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        send(ws, { type: 'error', message })
      }
    })()
  })
}
