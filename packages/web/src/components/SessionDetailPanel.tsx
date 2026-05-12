import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { fetchSessionDetail, triggerConsolidate, triggerIntegrate } from '@/lib/api'
import type { SessionDetail } from '@/lib/types'

interface SessionDetailPanelProps {
  spaceId: string
  sessionId: string
  onClose: () => void
}

/** Markdown 内容渲染 */
function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="prose-sm max-w-none text-text [&_p]:my-1 [&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:text-text [&_ul]:my-1 [&_ol]:my-1 [&_li]:text-[13px] [&_li]:text-text [&_strong]:text-text [&_strong]:font-semibold [&_code]:text-[11px] [&_code]:bg-surface [&_code]:text-primary-dark [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-[#2a2520] [&_pre]:text-[#e5e4e1] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-[11px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

/** L2 卡片（Main Session 的各节点摘要列表） */
function L2Card({ label, l2 }: { label: string; l2: string | null }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border/40 rounded-lg bg-card/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-surface/50 transition-colors"
      >
        {expanded
          ? <ChevronDown size={12} className="text-text-muted shrink-0" />
          : <ChevronRight size={12} className="text-text-muted shrink-0" />}
        <span className="text-[12px] font-semibold text-text">{label}</span>
        {!l2 && <span className="text-[10px] text-text-muted ml-auto">暂无</span>}
      </button>
      {expanded && l2 && (
        <div className="border-t border-border/30 px-3 py-2">
          <MarkdownContent text={l2} />
        </div>
      )}
      {!expanded && l2 && (
        <div className="px-3 pb-2">
          <p className="text-[11px] text-text-secondary line-clamp-2">{l2}</p>
        </div>
      )}
    </div>
  )
}

/** Session 详情侧边面板 */
export function SessionDetailPanel({ spaceId, sessionId, onClose }: SessionDetailPanelProps) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSessionDetail(spaceId, sessionId)
      setDetail(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [spaceId, sessionId])

  useEffect(() => { loadDetail() }, [loadDetail])

  /** 手动触发 consolidate */
  const handleConsolidate = async () => {
    setTriggering(true)
    try {
      await triggerConsolidate(spaceId, sessionId)
      await loadDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提炼失败')
    } finally {
      setTriggering(false)
    }
  }

  /** 手动触发 integrate */
  const handleIntegrate = async () => {
    setTriggering(true)
    try {
      await triggerIntegrate(spaceId)
      await loadDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : '综合分析失败')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="absolute top-0 right-0 w-[360px] h-full backdrop-blur-sm shadow-xl z-10 flex flex-col"
      style={{ background: 'rgba(247,244,238,0.95)', borderLeft: '1.5px solid var(--color-grid-line)' }}
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between h-12 px-4 shrink-0" style={{ borderBottom: '1.5px solid var(--color-grid-line)' }}>
        <span className="truncate" style={{ fontFamily: 'var(--font-hand)', fontSize: 16, fontWeight: 600, color: 'var(--color-ink)' }}>
          {detail?.type === 'main' ? 'Main Session' : detail?.type === 'child' ? detail.label : 'details'}
        </span>
        <button onClick={onClose} className="p-1 rounded transition-colors hover:opacity-60">
          <X size={14} style={{ color: 'var(--color-pencil)' }} />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="text-[12px] text-error bg-error/10 rounded-lg px-3 py-2">{error}</div>
        )}

        {!loading && detail?.type === 'child' && (
          <>
            {/* 摘要 */}
            <section>
              <h3 className="mb-2" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, fontWeight: 600, color: 'var(--color-pencil)', letterSpacing: '0.05em' }}>摘要</h3>
              {detail.l2 ? (
                <div className="bg-surface rounded-lg px-3 py-2 border border-border/30">
                  <MarkdownContent text={detail.l2} />
                </div>
              ) : (
                <p className="text-[12px] text-text-muted">暂无摘要（需要对话后触发提炼）</p>
              )}
            </section>

            {/* Insight */}
            {detail.insight && (
              <section>
                <h3 className="mb-2" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, fontWeight: 600, color: 'var(--color-pencil)', letterSpacing: '0.05em' }}>Insight</h3>
                <div className="bg-surface rounded-lg px-3 py-2 border border-border/30">
                  <MarkdownContent text={detail.insight} />
                </div>
              </section>
            )}

            {/* 操作按钮 */}
            <button
              onClick={handleConsolidate}
              disabled={triggering}
              className="flex items-center gap-2 disabled:opacity-50 transition-colors hover:opacity-70"
              style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-blue-pen)' }}
            >
              {triggering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              consolidate now
            </button>
          </>
        )}

        {!loading && detail?.type === 'main' && (
          <>
            {/* 综合分析 */}
            <section>
              <h3 className="mb-2" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, fontWeight: 600, color: 'var(--color-pencil)', letterSpacing: '0.05em' }}>综合分析</h3>
              {detail.synthesis ? (
                <div className="bg-surface rounded-lg px-3 py-2 border border-border/30">
                  <MarkdownContent text={detail.synthesis} />
                </div>
              ) : (
                <p className="text-[12px] text-text-muted">暂无综合分析（需要子节点提炼后触发综合）</p>
              )}
            </section>

            {/* 操作按钮 */}
            <button
              onClick={handleIntegrate}
              disabled={triggering}
              className="flex items-center gap-2 disabled:opacity-50 transition-colors hover:opacity-70"
              style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-blue-pen)' }}
            >
              {triggering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              integrate now
            </button>

            {/* 各节点摘要 */}
            <section>
              <h3 className="mb-2" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, fontWeight: 600, color: 'var(--color-pencil)', letterSpacing: '0.05em' }}>
                各节点摘要 ({detail.childL2s.length})
              </h3>
              <div className="space-y-2">
                {detail.childL2s.length === 0 && (
                  <p className="text-[12px] text-text-muted">暂无子节点</p>
                )}
                {detail.childL2s.map((child) => (
                  <L2Card key={child.sessionId} label={child.label} l2={child.l2} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
