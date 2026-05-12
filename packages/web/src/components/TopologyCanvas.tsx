import { useRef, useEffect, useState, useCallback } from 'react'
import { wobblyLine, scribbleNode, getNodeColor } from '@/lib/doodle'
import type { TopoNode } from '@/lib/types'

/** 布局后节点 */
interface LayoutNode extends TopoNode {
  x: number
  y: number
  r: number
  color: string
}

/** 同心环布局算法 */
function computeLayout(nodes: TopoNode[], width: number, height: number): LayoutNode[] {
  const cx = width / 2
  const cy = height / 2

  const activeNodes = nodes.filter((n) => n.status !== 'inactive')
  const inactiveNodes = nodes.filter((n) => n.status === 'inactive')

  const nodeMap = new Map(activeNodes.map((n) => [n.id, n]))
  const result: LayoutNode[] = []

  const root = activeNodes.find((n) => n.parentId === null)
  if (!root) {
    // 只有 inactive 节点时直接散布
    const outerRadius = Math.min(width, height) * 0.3
    for (let i = 0; i < inactiveNodes.length; i++) {
      const node = inactiveNodes[i]!
      const angle = (2 * Math.PI * i) / Math.max(inactiveNodes.length, 1) - Math.PI / 2
      result.push({
        ...node,
        x: cx + Math.cos(angle) * outerRadius,
        y: cy + Math.sin(angle) * outerRadius,
        r: 8,
        color: '#999999',
      })
    }
    return result
  }

  // BFS 分层
  const layers: TopoNode[][] = [[root]]
  const visited = new Set([root.id])
  let current = [root]

  while (current.length > 0) {
    const next: TopoNode[] = []
    for (const node of current) {
      for (const childId of node.children) {
        const child = nodeMap.get(childId)
        if (child && !visited.has(child.id)) {
          visited.add(child.id)
          next.push(child)
        }
      }
    }
    if (next.length > 0) layers.push(next)
    current = next
  }

  const ringSpacing = Math.min(width, height) / 6
  let colorIdx = 0

  for (let layer = 0; layer < layers.length; layer++) {
    const ring = layers[layer]!
    const radius = layer === 0 ? 0 : ringSpacing * (0.7 + layer * 0.45)

    for (let i = 0; i < ring.length; i++) {
      const node = ring[i]!
      const isMain = node.parentId === null
      const angle = ring.length === 1 ? 0 : (2 * Math.PI * i) / ring.length - Math.PI / 2

      // 确定性抖动
      const jitterX = layer === 0 ? 0 : Math.sin(i * 7.3 + layer * 2.1) * ringSpacing * 0.15
      const jitterY = layer === 0 ? 0 : Math.cos(i * 5.7 + layer * 3.4) * ringSpacing * 0.15

      const x = cx + Math.cos(angle) * radius + jitterX
      const y = cy + Math.sin(angle) * radius + jitterY

      const r = isMain ? 28 : Math.max(8, 16 - layer * 2)
      const color = isMain ? '#3a6bc5' : getNodeColor(colorIdx++)

      result.push({ ...node, x, y, r, color })
    }
  }

  // 未激活 preset 节点 — 散布在外环
  const outerRadius = ringSpacing * (layers.length + 0.5)
  for (let i = 0; i < inactiveNodes.length; i++) {
    const node = inactiveNodes[i]!
    const angle = (2 * Math.PI * i) / Math.max(inactiveNodes.length, 1) - Math.PI / 2
    const jitterR = Math.sin(i * 3.7) * ringSpacing * 0.1

    result.push({
      ...node,
      x: cx + Math.cos(angle) * (outerRadius + jitterR),
      y: cy + Math.sin(angle) * (outerRadius + jitterR),
      r: 8,
      color: '#999999',
    })
  }

  return result
}

interface TopologyCanvasProps {
  nodes: TopoNode[]
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string) => void
  onNodeDetail?: (nodeId: string) => void
}

/** 节点拓扑图组件 — 手绘涂鸦风格 */
export function TopologyCanvas({ nodes, selectedNodeId, onNodeSelect, onNodeDetail }: TopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<LayoutNode[]>([])
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)

  // 平移和缩放
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const panRef = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panStart = useRef({ x: 0, y: 0 })
  const hasDragged = useRef(false)

  // 新节点动画追踪
  const knownNodeIds = useRef<Set<string>>(new Set())
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set())

  useEffect(() => { hoveredRef.current = hoveredId }, [hoveredId])
  useEffect(() => { selectedRef.current = selectedNodeId }, [selectedNodeId])
  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // 布局计算 + 新节点检测
  useEffect(() => {
    const layout = computeLayout(nodes, size.width, size.height)
    nodesRef.current = layout

    const isFirst = knownNodeIds.current.size === 0
    if (!isFirst) {
      const currentIds = new Set(layout.map((n) => n.id))
      const fresh = new Set<string>()
      for (const id of currentIds) {
        if (!knownNodeIds.current.has(id)) fresh.add(id)
      }
      knownNodeIds.current = currentIds
      if (fresh.size > 0) {
        setNewNodeIds(fresh)
        setTimeout(() => setNewNodeIds(new Set()), 1500)
      }
    } else {
      knownNodeIds.current = new Set(layout.map((n) => n.id))
    }
  }, [nodes, size])

  // 渲染 Canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = size.width
    const h = size.height

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    ctx.save()
    ctx.translate(panRef.current.x, panRef.current.y)
    ctx.scale(zoomRef.current, zoomRef.current)

    const layoutNodes = nodesRef.current
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]))
    const hovered = hoveredRef.current
    const selected = selectedRef.current

    // 画连线 — 手绘抖动线条，截断在节点边缘
    for (const node of layoutNodes) {
      if (node.status === 'inactive') continue
      if (!node.parentId) continue
      const parent = nodeMap.get(node.parentId)
      if (!parent) continue

      const dx = node.x - parent.x
      const dy = node.y - parent.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < (parent.r + node.r + 4)) continue
      const ux = dx / dist, uy = dy / dist
      const x1 = parent.x + ux * (parent.r + 4)
      const y1 = parent.y + uy * (parent.r + 4)
      const x2 = node.x - ux * (node.r + 4)
      const y2 = node.y - uy * (node.r + 4)

      ctx.save()
      ctx.strokeStyle = 'rgba(34,34,34,0.35)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      wobblyLine(ctx, x1, y1, x2, y2, 1.5)
      ctx.restore()
    }

    // 画节点 — 手绘涂鸦风格
    for (const node of layoutNodes) {
      const isActive = selected === node.id
      const isHovered = hovered === node.id
      const isInactive = node.status === 'inactive'
      const tc = node.turns || 0
      const activityAlpha = Math.min(1, 0.5 + tc * 0.1)
      const baseAlpha = isInactive
        ? 0.3
        : isActive || isHovered
          ? 1
          : activityAlpha

      const nodeColor = isInactive ? '#999999' : node.color
      scribbleNode(ctx, node.x, node.y, node.r, nodeColor, baseAlpha, isActive || isHovered)
    }

    // 画标签 — 碰撞检测避免重叠
    const labelBoxes: { x: number; y: number; w: number; h: number }[] = []
    const labelData: { node: LayoutNode; text: string; fontSize: number; baseY: number }[] = []

    for (const node of layoutNodes) {
      const isCore = !node.parentId
      const fontSize = isCore ? 18 : 14
      const text = node.label || node.id.slice(0, 6)
      ctx.font = `${fontSize}px "Caveat", cursive`
      const tw = ctx.measureText(text).width
      const baseY = node.y + node.r + (isCore ? 22 : 16)
      labelData.push({ node, text, fontSize, baseY })
      labelBoxes.push({ x: node.x - tw / 2, y: baseY - fontSize, w: tw, h: fontSize + 4 })
    }

    // 简单碰撞偏移
    for (let i = 0; i < labelBoxes.length; i++) {
      for (let j = i + 1; j < labelBoxes.length; j++) {
        const a = labelBoxes[i]!, b = labelBoxes[j]!
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          const shift = a.y + a.h - b.y + 2
          b.y += shift
          labelData[j]!.baseY += shift
        }
      }
    }

    for (const { node, text, fontSize, baseY } of labelData) {
      const isActive = selected === node.id
      const isCore = !node.parentId
      const isInactive = node.status === 'inactive'
      ctx.font = `${fontSize}px "Caveat", cursive`
      ctx.textAlign = 'center'
      ctx.fillStyle = isInactive
        ? 'rgba(34,34,34,0.2)'
        : isActive || hovered === node.id
          ? node.color
          : isCore
            ? 'rgba(34,34,34,0.7)'
            : 'rgba(34,34,34,0.5)'
      ctx.fillText(text, node.x, baseY)
    }

    ctx.restore()
  }, [size])

  // rAF 渲染循环
  useEffect(() => {
    let animId: number
    const loop = () => {
      render()
      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [render])

  // 屏幕坐标 → 画布坐标
  const toCanvas = useCallback(
    (screenX: number, screenY: number) => {
      return { x: (screenX - pan.x) / zoom, y: (screenY - pan.y) / zoom }
    },
    [pan, zoom],
  )

  /** 查找鼠标下的节点 */
  const hitTest = useCallback((sx: number, sy: number): LayoutNode | null => {
    const { x: cx, y: cy } = toCanvas(sx, sy)
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const node = nodesRef.current[i]!
      const dx = cx - node.x
      const dy = cy - node.y
      if (dx * dx + dy * dy < (node.r + 6) ** 2) return node
    }
    return null
  }, [toCanvas])

  // 鼠标滚轮缩放（以鼠标位置为中心）
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const step = 0.02
    const direction = e.deltaY > 0 ? -step : step
    setZoom((prev) => {
      const next = Math.min(2.0, Math.max(0.3, prev + direction))
      const scale = next / prev
      setPan((p) => ({
        x: mx - scale * (mx - p.x),
        y: my - scale * (my - p.y),
      }))
      return next
    })
  }, [])

  // 绑定 wheel（passive: false）
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    hasDragged.current = false
    dragStart.current = { x: e.clientX, y: e.clientY }
    panStart.current = { ...pan }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    if (dragging.current) {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true
      setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy })
      return
    }

    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const found = hitTest(mx, my)
    setHoveredId(found?.id ?? null)

    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = found ? 'pointer' : 'grab'
  }, [hitTest])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const wasDrag = hasDragged.current
    dragging.current = false
    hasDragged.current = false
    if (wasDrag) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const found = hitTest(mx, my)
    if (found) {
      onNodeSelect(found.id)
      onNodeDetail?.(found.id)
    }
  }, [hitTest, onNodeSelect, onNodeDetail])

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{
        background: `
          var(--color-paper, #f7f4ee)
          repeating-linear-gradient(0deg, transparent, transparent 31px, rgba(180,200,230,0.12) 31px, rgba(180,200,230,0.12) 32px)
          ,repeating-linear-gradient(90deg, transparent, transparent 31px, rgba(180,200,230,0.12) 31px, rgba(180,200,230,0.12) 32px)
        `,
        backgroundSize: 'auto, 32px 32px, 32px 32px',
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragging.current = false
          setHoveredId(null)
        }}
        style={{ cursor: dragging.current ? 'grabbing' : hoveredId ? 'pointer' : 'grab' }}
      />

      {/* 新节点生长动画 — 线条缓慢延伸 → 标签浮现 */}
      {Array.from(newNodeIds).map((id) => {
        const node = nodesRef.current.find((n) => n.id === id)
        if (!node) return null
        const cx = node.x * zoom + pan.x
        const cy = node.y * zoom + pan.y
        const parent = node.parentId
          ? nodesRef.current.find((n) => n.id === node.parentId)
          : null
        const px = parent ? parent.x * zoom + pan.x : cx
        const py = parent ? parent.y * zoom + pan.y : cy
        const dx = cx - px
        const dy = cy - py
        const dist = Math.sqrt(dx * dx + dy * dy)
        const parentR = parent ? parent.r * zoom : 0
        const nodeRScaled = node.r * zoom
        const ux = dist > 0 ? dx / dist : 0
        const uy = dist > 0 ? dy / dist : 0
        const lx1 = px + ux * (parentR + 4)
        const ly1 = py + uy * (parentR + 4)
        const lx2 = cx - ux * (nodeRScaled + 4)
        const ly2 = cy - uy * (nodeRScaled + 4)
        const lineLen = Math.sqrt((lx2 - lx1) ** 2 + (ly2 - ly1) ** 2)
        const lineDur = 1000
        const labelDelay = 800
        return (
          <div
            key={`anim-${id}`}
            className="pointer-events-none z-20"
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
          >
            {parent && lineLen > 0 && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ overflow: 'visible' }}
              >
                <line
                  x1={lx1} y1={ly1} x2={lx2} y2={ly2}
                  stroke={node.color}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  ref={(el) => {
                    if (!el) return
                    el.setAttribute('stroke-dasharray', String(lineLen))
                    el.setAttribute('stroke-dashoffset', String(lineLen))
                    el.animate(
                      [
                        { strokeDashoffset: lineLen, opacity: 0.2 },
                        { strokeDashoffset: 0, opacity: 0.45 },
                      ],
                      { duration: lineDur, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)', fill: 'forwards' },
                    )
                  }}
                />
              </svg>
            )}
            <div
              ref={(el) => {
                if (!el) return
                el.animate(
                  [
                    { opacity: 0, transform: 'translateY(4px)' },
                    { opacity: 1, transform: 'translateY(0)' },
                  ],
                  { duration: 500, delay: labelDelay, easing: 'ease-out', fill: 'forwards' },
                )
              }}
              style={{
                position: 'absolute',
                left: cx - 60,
                top: cy + node.r * zoom + 4,
                width: 120,
                textAlign: 'center',
                fontFamily: '"Caveat", cursive',
                fontSize: 14,
                color: 'rgba(34,34,34,0.5)',
                opacity: 0,
              }}
            >
              {node.label || node.id.slice(0, 6)}
            </div>
          </div>
        )
      })}

      {/* 标题 — Idea Map */}
      <div
        className="absolute top-5 left-6 z-10 pointer-events-none"
        style={{ transform: 'rotate(-2deg)' }}
      >
        <h1
          className="text-[32px] font-bold relative"
          style={{ fontFamily: 'var(--font-hand)', color: 'var(--color-ink)' }}
        >
          Idea Map
          <span
            className="absolute inset-[-8px_-14px]"
            style={{
              border: '2px solid var(--color-red-pen)',
              borderRadius: '55% 45% 50% 50% / 45% 55% 45% 55%',
              opacity: 0.3,
              transform: 'rotate(2deg)',
            }}
          />
        </h1>
      </div>

      {/* 图例 */}
      <div
        className="absolute bottom-5 left-6 z-10 pointer-events-none"
        style={{
          fontFamily: 'var(--font-hand-sm)',
          fontSize: 13,
          color: 'var(--color-pencil)',
          lineHeight: 2,
          transform: 'rotate(1deg)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-[2px] rounded-sm" style={{ background: 'rgba(34,34,34,0.35)' }} />
          parent → child
        </div>
      </div>

      {/* 缩放指示器 */}
      <div
        className="absolute bottom-5 right-6 z-10 cursor-pointer select-none"
        onClick={() => {
          const el = containerRef.current
          if (!el) return
          const { width, height } = el.getBoundingClientRect()
          const cx = width / 2
          const cy = height / 2
          const scale = 1 / zoom
          setPan((p) => ({
            x: cx - scale * (cx - p.x),
            y: cy - scale * (cy - p.y),
          }))
          setZoom(1)
        }}
        title="点击重置为 100%"
        style={{
          fontFamily: 'var(--font-hand-sm)',
          fontSize: 13,
          color: 'var(--color-pencil)',
          opacity: 0.6,
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
      >
        {Math.round(zoom * 100)}%
      </div>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--color-pencil)', fontFamily: 'var(--font-hand-sm)', fontSize: 14 }}>
          暂无节点
        </div>
      )}
    </div>
  )
}
