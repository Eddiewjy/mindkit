/** 手绘涂鸦风格的 Canvas 绘图工具 */

/** 随机偏移 */
function rnd(range: number): number {
  return (Math.random() - 0.5) * 2 * range
}

/** 手绘抖动线条 */
export function wobblyLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  wobble = 1.5,
) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  const steps = Math.max(Math.floor(len / 8), 4)
  const nx = -dy / len, ny = dx / len

  ctx.beginPath()
  ctx.moveTo(x1 + rnd(wobble), y1 + rnd(wobble))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    ctx.lineTo(
      x1 + dx * t + nx * rnd(wobble),
      y1 + dy * t + ny * rnd(wobble),
    )
  }
  ctx.stroke()
}

/** 手绘涂鸦填充节点 */
export function scribbleNode(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  r: number,
  color: string,
  alpha: number,
  isHovered: boolean,
) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 锯齿填充
  const fillAngle = -0.4 + rnd(0.15)
  const cosA = Math.cos(fillAngle), sinA = Math.sin(fillAngle)
  const spacing = 3.5 + rnd(0.5)
  const fillR = r * 0.95
  const count = Math.ceil(fillR * 2 / spacing)

  ctx.beginPath()
  let first = true
  for (let i = 0; i < count; i++) {
    const yLocal = -fillR + i * spacing + rnd(1)
    const halfChord = Math.sqrt(Math.max(0, fillR * fillR - yLocal * yLocal))
    if (halfChord < 2) continue
    const goRight = i % 2 === 0
    const x1 = goRight ? -halfChord : halfChord
    const x2 = goRight ? halfChord : -halfChord
    const sx1 = cx + x1 * cosA - yLocal * sinA + rnd(1.5)
    const sy1 = cy + x1 * sinA + yLocal * cosA + rnd(1.5)
    const sx2 = cx + x2 * cosA - yLocal * sinA + rnd(1.5)
    const sy2 = cy + x2 * sinA + yLocal * cosA + rnd(1.5)
    if (first) { ctx.moveTo(sx1, sy1); first = false }
    else { ctx.lineTo(sx1, sy1) }
    const midX = (sx1 + sx2) / 2 + rnd(2)
    const midY = (sy1 + sy2) / 2 + rnd(2)
    ctx.quadraticCurveTo(midX, midY, sx2, sy2)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1.4 + (isHovered ? 0.4 : 0)
  ctx.globalAlpha = alpha * 0.55
  ctx.stroke()

  // 手绘圆圈轮廓
  const rings = isHovered ? 2 : 1
  for (let ring = 0; ring < rings; ring++) {
    const rr = r + ring * 1.5 + rnd(1)
    const w = 2.5 + ring
    const startA = rnd(0.5)
    const sweep = Math.PI * 2 + rnd(0.6) - 0.1
    const steps = 32
    ctx.beginPath()
    for (let i = 0; i <= steps; i++) {
      const a = startA + (i / steps) * sweep
      const wr = rr + rnd(w)
      const x = cx + Math.cos(a) * wr
      const y = cy + Math.sin(a) * wr
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1.6 - ring * 0.3
    ctx.globalAlpha = alpha * (0.75 - ring * 0.2)
    ctx.stroke()
  }

  ctx.restore()
}

/** 节点颜色表 */
const NODE_COLORS = ['#3a6bc5', '#c94a4a', '#5ba85b', '#c78a30', '#7E57C2']

/** 根据索引获取节点颜色 */
export function getNodeColor(index: number): string {
  return NODE_COLORS[index % NODE_COLORS.length]
}
