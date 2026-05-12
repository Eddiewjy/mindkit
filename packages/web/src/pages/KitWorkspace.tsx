import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { fetchTopology, fetchSpaces, enterSession } from '@/lib/api'
import { ChatPanel } from '@/components/ChatPanel'
import { TopologyCanvas } from '@/components/TopologyCanvas'
import { SessionDetailPanel } from '@/components/SessionDetailPanel'
import type { SessionTreeNode, TopoNode, SpaceMeta, WsMessage } from '@/lib/types'

/** 递归树 → 扁平节点数组 */
function flattenTree(node: SessionTreeNode, parentId: string | null): TopoNode[] {
  const flat: TopoNode = {
    id: node.id,
    label: node.label,
    parentId,
    status: node.status,
    turns: node.turnCount,
    children: node.children.map((c) => c.id),
  }
  return [flat, ...node.children.flatMap((c) => flattenTree(c, node.id))]
}

/** Kit 工作界面 — 左侧对话 + 右侧拓扑图 */
export function KitWorkspace() {
  const { id: spaceId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [nodes, setNodes] = useState<TopoNode[]>([])
  const [spaceMeta, setSpaceMeta] = useState<SpaceMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null)
  const [activatedPresets, setActivatedPresets] = useState<Record<string, string>>({})

  /** 拉取拓扑并扁平化 */
  const refreshTopology = useCallback(async () => {
    if (!spaceId) return
    try {
      const tree = await fetchTopology(spaceId)
      const flat = flattenTree(tree, null)
      setNodes(flat)
      // 首次加载默认选中主节点
      setSelectedNodeId((prev) => prev ?? flat.find((n) => n.parentId === null)?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '拓扑加载失败')
    }
  }, [spaceId])

  /** 初始加载 — 并行拉取 space 元数据 + 拓扑 */
  useEffect(() => {
    if (!spaceId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [spaces, tree] = await Promise.all([
          fetchSpaces(),
          fetchTopology(spaceId!),
        ])
        if (cancelled) return

        const meta = spaces.find((s) => s.id === spaceId) ?? null
        setSpaceMeta(meta)
        setActivatedPresets(meta?.activatedPresets ?? {})

        const flat = flattenTree(tree, null)
        setNodes(flat)
        setSelectedNodeId(flat.find((n) => n.parentId === null)?.id ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [spaceId])

  /** WS 连接 — 监听 node_forked 事件刷新拓扑 */
  useEffect(() => {
    if (!spaceId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/spaces/${spaceId}`)

    ws.addEventListener('message', (evt) => {
      try {
        const msg: WsMessage = JSON.parse(evt.data as string)
        if (msg.type === 'space_event' && msg.event.kind === 'node_forked') {
          const payload = msg.event.payload as { activatedPreset?: string; nodeId?: string }
          if (payload.activatedPreset && payload.nodeId) {
            setActivatedPresets((prev) => ({
              ...prev,
              [payload.activatedPreset!]: payload.nodeId as string,
            }))
          }
          refreshTopology()
        }
      } catch {
        // 忽略非 JSON 消息
      }
    })

    return () => { ws.close() }
  }, [spaceId, refreshTopology])

  /** 合并真实拓扑节点 + 未激活 preset 虚拟节点 */
  const mergedNodes = useMemo(() => {
    if (!spaceMeta?.presetSessions?.length) return nodes

    const virtualNodes: TopoNode[] = spaceMeta.presetSessions
      .filter((ps) => !activatedPresets[ps.name])
      .map((ps) => ({
        id: `preset:${ps.name}`,
        label: ps.label,
        parentId: null,
        status: 'inactive' as const,
        turns: 0,
        children: [],
        presetName: ps.name,
      }))

    return [...nodes, ...virtualNodes]
  }, [nodes, spaceMeta?.presetSessions, activatedPresets])

  const activeNode = useMemo(
    () => mergedNodes.find((n) => n.id === selectedNodeId) ?? null,
    [mergedNodes, selectedNodeId],
  )

  if (!spaceId) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--color-paper)', color: 'var(--color-pencil)', fontFamily: 'var(--font-hand-alt)' }}>
        <div className="text-center">
          <p style={{ fontSize: 18 }}>space not found</p>
          <button onClick={() => navigate('/')} style={{ color: 'var(--color-blue-pen)', fontSize: 14, fontFamily: 'var(--font-hand-sm)' }} className="mt-2 hover:underline">
            back to list
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--color-paper)', color: 'var(--color-pencil)', fontFamily: 'var(--font-hand-alt)' }}>
        <p style={{ fontSize: 16 }}>loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--color-paper)', fontFamily: 'var(--font-hand-alt)' }}>
        <div className="text-center">
          <p style={{ color: 'var(--color-red-pen)', fontSize: 16 }}>{error}</p>
          <button onClick={() => navigate('/')} style={{ color: 'var(--color-blue-pen)', fontSize: 14, fontFamily: 'var(--font-hand-sm)' }} className="mt-2 hover:underline">
            back to list
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--color-paper)' }}>
      {/* 顶栏 — 笔记本风格 */}
      <div className="h-12 px-4 flex items-center shrink-0" style={{ borderBottom: '1.5px solid var(--color-grid-line)' }}>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 mr-4 transition-colors hover:opacity-70"
          style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 13, color: 'var(--color-pencil)' }}
        >
          <ArrowLeft size={14} style={{ color: 'var(--color-pencil)' }} />
          back
        </button>
        <h2 style={{ fontFamily: 'var(--font-hand)', fontSize: 20, fontWeight: 600, color: 'var(--color-ink)' }}>
          {spaceMeta?.name ?? spaceId}
        </h2>
        {spaceMeta?.mode && (
          <span className="ml-2 px-2 py-0.5 rounded-full" style={{
            fontFamily: 'var(--font-hand-sm)', fontSize: 11,
            background: 'rgba(58,107,197,0.08)', color: 'var(--color-blue-pen)',
          }}>
            {spaceMeta.mode}
          </span>
        )}
        {spaceMeta?.presetSessions && spaceMeta.presetSessions.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 rounded" style={{
            fontFamily: 'var(--font-hand-sm)', fontSize: 10,
            background: 'rgba(42,42,42,0.04)', border: '1px solid rgba(42,42,42,0.06)', color: 'var(--color-pencil)',
          }}>
            {Object.keys(activatedPresets).length}/{spaceMeta.presetSessions.length} lit
          </span>
        )}
      </div>

      {/* 主内容区 — 左右对半 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：对话面板 */}
        <div className="w-1/2" style={{ borderRight: '1.5px solid var(--color-grid-line)' }}>
          <ChatPanel
            spaceId={spaceId}
            sessionId={activeNode?.id ?? null}
            sessionLabel={activeNode?.label ?? ''}
            onTurnComplete={refreshTopology}
          />
        </div>

        {/* 右侧：拓扑图 + 详情面板 */}
        <div className="w-1/2 relative">
          <TopologyCanvas
            nodes={mergedNodes}
            selectedNodeId={selectedNodeId}
            onNodeSelect={(nodeId) => {
              if (nodeId.startsWith('preset:')) return
              setSelectedNodeId(nodeId)
              // 通知 Orchestrator 切换 session，触发离开旧 session 的 consolidation
              enterSession(spaceId!, nodeId).catch(() => {})
            }}
            onNodeDetail={(nodeId) => {
              if (nodeId.startsWith('preset:')) return
              setDetailSessionId(nodeId)
            }}
          />
          {detailSessionId && spaceId && (
            <SessionDetailPanel
              spaceId={spaceId}
              sessionId={detailSessionId}
              onClose={() => setDetailSessionId(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
