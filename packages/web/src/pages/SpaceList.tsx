import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, GitBranch, ChevronDown, ChevronRight, X, Store, Wrench, ArrowLeft, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchSpaces, fetchPresets, createSpace, deleteSpace } from '@/lib/api'
import type { SpaceMeta, PresetConfig } from '@/lib/types'

/* ─── 便签卡片样式变体 ─── */
const ROTATIONS = ['-1.2deg', '0.8deg', '-0.6deg', '1.1deg', '-0.4deg', '0.9deg']
const WOBBLY_RADII = [
  '15px 25px 20px 10px',
  '20px 15px 25px 12px',
  '12px 20px 15px 25px',
  '25px 12px 18px 15px',
  '18px 22px 12px 20px',
  '14px 18px 22px 16px',
]
const TAPE_ROTATIONS = ['-2deg', '1.5deg', '-3deg', '2deg', '-1deg', '3deg']

/** 生成便签卡片内联样式 */
function stickyStyle(idx: number, extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '24px 28px 32px',
    background: '#FFF9C4',
    border: '2.5px solid rgba(45,45,45,0.12)',
    borderRadius: WOBBLY_RADII[idx % WOBBLY_RADII.length],
    boxShadow: '4px 4px 0 rgba(45,45,45,0.08)',
    transform: `rotate(${ROTATIONS[idx % ROTATIONS.length]})`,
    ...extra,
  }
}

/* ─── Emoji 选择器 ─── */

const EMOJI_OPTIONS = ['🧠', '🚀', '💡', '🎯', '📚', '🔬', '🎨', '🏗️', '📝', '🌟', '⚡', '🔥', '🎮', '🎵', '🌍', '💼']

function EmojiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-12 h-12 rounded-xl border border-border bg-surface flex items-center justify-center text-2xl hover:border-primary/50 transition-colors"
      >
        {value}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-card rounded-lg border border-border shadow-lg z-50 p-2 grid grid-cols-8 gap-1">
          {EMOJI_OPTIONS.map((e) => (
            <button
              key={e}
              onClick={() => { onChange(e); setOpen(false) }}
              className={cn('w-8 h-8 rounded flex items-center justify-center text-lg hover:bg-surface transition-colors', value === e && 'bg-primary-light')}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── 颜色选择器 ─── */

const COLOR_OPTIONS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#64748b']

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {COLOR_OPTIONS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn('w-7 h-7 rounded-full border-2 transition-all', value === c ? 'border-text scale-110' : 'border-transparent hover:scale-105')}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

/* ─── PresetSession 编辑器 ─── */

interface PresetSessionDraft {
  name: string
  label: string
  systemPrompt: string
  systemPromptMode: 'preset' | 'prepend' | 'append'
  context: 'inherit' | 'none'
  consolidatePrompt: string
  guidePrompt: string
  activationHint: string
}

function PresetSessionEditor({
  sessions,
  onChange,
}: {
  sessions: PresetSessionDraft[]
  onChange: (s: PresetSessionDraft[]) => void
}) {
  const addSession = () => {
    onChange([...sessions, { name: '', label: '', systemPrompt: '', systemPromptMode: 'prepend', context: 'inherit', consolidatePrompt: '', guidePrompt: '', activationHint: '' }])
  }
  const removeSession = (i: number) => {
    onChange(sessions.filter((_, idx) => idx !== i))
  }
  const updateSession = (i: number, field: keyof PresetSessionDraft, value: string) => {
    const updated = [...sessions]
    updated[i] = { ...updated[i]!, [field]: value }
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      {sessions.map((s, i) => (
        <div key={i} className="bg-surface rounded-lg p-3 border border-border/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-text-muted">预设节点 #{i + 1}</span>
            <button onClick={() => removeSession(i)} className="text-text-muted hover:text-error transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="标识 (name)"
              value={s.name} onChange={(e) => updateSession(i, 'name', e.target.value)}
              className="px-2 py-1.5 rounded border border-border bg-card text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <input
              placeholder="显示名称 (label)"
              value={s.label} onChange={(e) => updateSession(i, 'label', e.target.value)}
              className="px-2 py-1.5 rounded border border-border bg-card text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <textarea
            placeholder="系统提示词 (systemPrompt)"
            value={s.systemPrompt} onChange={(e) => updateSession(i, 'systemPrompt', e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />
          {/* systemPromptMode + context */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-text-muted mb-1">提示词合成策略</label>
              <select
                value={s.systemPromptMode}
                onChange={(e) => updateSession(i, 'systemPromptMode', e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="prepend">prepend — 加在空间提示词前</option>
                <option value="append">append — 加在空间提示词后</option>
                <option value="preset">preset — 完全替换</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-text-muted mb-1">上下文继承</label>
              <select
                value={s.context}
                onChange={(e) => updateSession(i, 'context', e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="inherit">inherit — 继承父对话上下文</option>
                <option value="none">none — 空白上下文启动</option>
              </select>
            </div>
          </div>
          <textarea
            placeholder="节点专属 Consolidate Prompt（留空使用 space 级别）"
            value={s.consolidatePrompt} onChange={(e) => updateSession(i, 'consolidatePrompt', e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs font-mono placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />
          <input
            placeholder="引导语 (guidePrompt) — 进入节点时的开场问题"
            value={s.guidePrompt} onChange={(e) => updateSession(i, 'guidePrompt', e.target.value)}
            className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <input
            placeholder="激活条件 (activationHint) — AI 何时应激活此节点"
            value={s.activationHint} onChange={(e) => updateSession(i, 'activationHint', e.target.value)}
            className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      ))}
      <button
        onClick={addSession}
        className="w-full py-2 border border-dashed border-border rounded-lg text-xs text-text-muted hover:border-primary/40 hover:text-primary transition-colors"
      >
        + 添加预设节点
      </button>
    </div>
  )
}

/* ─── Skill 编辑器 ─── */

interface SkillDraft {
  name: string
  description: string
  content: string
}

function SkillEditor({ skills, onChange }: { skills: SkillDraft[]; onChange: (s: SkillDraft[]) => void }) {
  const addSkill = () => {
    onChange([...skills, { name: '', description: '', content: '' }])
  }
  const removeSkill = (i: number) => {
    onChange(skills.filter((_, idx) => idx !== i))
  }
  const updateSkill = (i: number, field: keyof SkillDraft, value: string) => {
    const updated = [...skills]
    updated[i] = { ...updated[i]!, [field]: value }
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      {skills.map((s, i) => (
        <div key={i} className="bg-surface rounded-lg p-3 border border-border/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-text-muted">技能 #{i + 1}</span>
            <button onClick={() => removeSkill(i)} className="text-text-muted hover:text-error transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="技能名称 (name)"
              value={s.name} onChange={(e) => updateSkill(i, 'name', e.target.value)}
              className="px-2 py-1.5 rounded border border-border bg-card text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <input
              placeholder="描述 (description)"
              value={s.description} onChange={(e) => updateSkill(i, 'description', e.target.value)}
              className="px-2 py-1.5 rounded border border-border bg-card text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <textarea
            placeholder="激活时注入的完整 prompt (content)"
            value={s.content} onChange={(e) => updateSkill(i, 'content', e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs font-mono placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />
        </div>
      ))}
      <button
        onClick={addSkill}
        className="w-full py-2 border border-dashed border-border rounded-lg text-xs text-text-muted hover:border-primary/40 hover:text-primary transition-colors"
      >
        + 添加技能
      </button>
    </div>
  )
}

/* ─── Market 弹窗：浏览 preset 并一键创建（配置只读） ─── */

function MarketModal({
  presets,
  initialSelected,
  onClose,
  onCreated,
}: {
  presets: PresetConfig[]
  initialSelected?: PresetConfig
  onClose: () => void
  onCreated: (meta: SpaceMeta) => void
}) {
  const [selected, setSelected] = useState<PresetConfig | null>(initialSelected ?? null)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(initialSelected?.emoji ?? '🧠')
  const [color, setColor] = useState(initialSelected?.color ?? '#3a6bc5')
  const [showDetail, setShowDetail] = useState(false)
  const [detailTab, setDetailTab] = useState<'prompt' | 'sessions' | 'skills' | 'memory'>('prompt')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const selectPreset = (p: PresetConfig) => {
    setSelected(p)
    setEmoji(p.emoji)
    setColor(p.color)
    setName('')
    setShowDetail(false)
  }

  const handleCreate = async () => {
    if (!selected || !name.trim()) return
    setLoading(true)
    setError('')
    try {
      const meta = await createSpace({
        name: name.trim(),
        presetDirName: selected.dirName,
        emoji,
        color,
      })
      onCreated(meta)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="rounded-sm shadow-2xl w-[640px] max-h-[85vh] flex flex-col"
        style={{ background: 'var(--color-paper)', transform: 'rotate(-0.5deg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1.5px solid var(--color-grid-line)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Store size={18} style={{ color: 'var(--color-blue-pen)' }} />
            <h2 style={{ fontFamily: 'var(--font-hand)', fontSize: 22, fontWeight: 600, color: 'var(--color-ink)' }}>使用模板创建</h2>
          </div>
          <p style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>配置名称和颜色，一键创建认知空间</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {selected && (
            <div className="space-y-5">

              {/* Preset 信息卡 */}
              <div className="rounded-lg p-4" style={{ background: 'rgba(42,42,42,0.04)', border: '1.5px solid rgba(42,42,42,0.08)' }}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-3xl">{selected.emoji}</span>
                  <div>
                    <h3 style={{ fontFamily: 'var(--font-hand)', fontSize: 20, fontWeight: 600, color: 'var(--color-blue-pen)' }}>{selected.name}</h3>
                    <p style={{ fontFamily: 'var(--font-hand-alt)', fontSize: 14, color: 'var(--color-pencil)' }}>{selected.description}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full ml-auto shrink-0" style={{
                    fontFamily: 'var(--font-hand-sm)', fontSize: 11,
                    background: selected.mode === 'AUTO' ? 'rgba(58,107,197,0.1)' : 'rgba(201,74,74,0.1)',
                    color: selected.mode === 'AUTO' ? 'var(--color-blue-pen)' : 'var(--color-red-pen)',
                  }}>
                    {selected.mode}
                  </span>
                </div>

                {/* 只读预览 toggle */}
                <button
                  onClick={() => setShowDetail(!showDetail)}
                  className="flex items-center gap-1 bg-transparent border-none cursor-pointer transition-colors hover:opacity-70"
                  style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}
                >
                  <Eye size={12} />
                  {showDetail ? 'hide details' : 'view details'}
                  {showDetail ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>

                {showDetail && (
                  <div className="mt-3">
                    {/* Tab 栏 */}
                    <div className="flex border-b border-border mb-3">
                      {([
                        { key: 'prompt' as const, label: '系统提示词' },
                        { key: 'sessions' as const, label: '预设节点', count: selected.forkProfiles.length },
                        { key: 'skills' as const, label: '技能', count: selected.skills.length },
                        { key: 'memory' as const, label: '记忆提炼' },
                      ]).map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => setDetailTab(tab.key)}
                          className={cn(
                            'px-3 py-2 text-[11px] font-medium transition-colors',
                            detailTab === tab.key
                              ? 'text-primary border-b-2 border-primary'
                              : 'text-text-muted hover:text-text-secondary',
                          )}
                        >
                          {tab.label}
                          {'count' in tab && (tab as { count?: number }).count! > 0 && (
                            <span className="ml-1 text-[10px] bg-primary-light text-primary px-1.5 rounded-full">{(tab as { count?: number }).count}</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* 系统提示词 */}
                    {detailTab === 'prompt' && (
                      <div className="space-y-3">
                        <div className="px-3 py-2 rounded-lg bg-card border border-border text-xs font-mono text-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {selected.systemPrompt || '(使用默认)'}
                        </div>
                        {selected.expectedArtifacts && (
                          <div>
                            <label className="block text-[10px] font-medium text-text-muted mb-1">预期产物</label>
                            <div className="px-3 py-2 rounded-lg bg-card border border-border text-xs text-text-secondary">
                              {selected.expectedArtifacts}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 预设节点 */}
                    {detailTab === 'sessions' && (
                      <div className="space-y-2">
                        {selected.forkProfiles.length === 0 ? (
                          <p className="text-[11px] text-text-muted">无预设节点</p>
                        ) : (
                          selected.forkProfiles.map((fp, i) => (
                            <div key={i} className="px-3 py-2.5 rounded-lg bg-card border border-border space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">{fp.name}</span>
                                <div className="flex gap-1 ml-auto">
                                  {fp.systemPromptMode && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-text-muted">{fp.systemPromptMode}</span>
                                  )}
                                  {fp.context && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-text-muted">{fp.context}</span>
                                  )}
                                </div>
                              </div>
                              {fp.systemPrompt && (
                                <div>
                                  <label className="block text-[9px] text-text-muted mb-0.5">系统提示词</label>
                                  <div className="text-[10px] text-text-secondary font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">
                                    {fp.systemPrompt}
                                  </div>
                                </div>
                              )}
                              {fp.consolidatePrompt && (
                                <div>
                                  <label className="block text-[9px] text-text-muted mb-0.5">Consolidate 提示词</label>
                                  <div className="text-[10px] text-text-secondary font-mono whitespace-pre-wrap max-h-20 overflow-y-auto">
                                    {fp.consolidatePrompt}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* 技能 */}
                    {detailTab === 'skills' && (
                      <div className="space-y-1.5">
                        {selected.skills.length === 0 ? (
                          <p className="text-[11px] text-text-muted">无技能</p>
                        ) : (
                          selected.skills.map((sk, i) => (
                            <div key={i} className="px-3 py-2 rounded-lg bg-card border border-border">
                              <div className="text-xs font-medium">{sk.name}</div>
                              <div className="text-[10px] text-text-muted">{sk.description}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* 记忆提炼 */}
                    {detailTab === 'memory' && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-medium text-text-muted mb-1">
                            Consolidate Prompt
                            <span className="ml-1 text-[10px] font-normal">（L3 对话 → L2 摘要）</span>
                          </label>
                          <div className="px-3 py-2 rounded-lg bg-card border border-border text-xs font-mono text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {selected.consolidatePrompt || '(使用 SDK 默认)'}
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-text-muted mb-1">
                            Integrate Prompt
                            <span className="ml-1 text-[10px] font-normal">（所有 L2 → synthesis + insights）</span>
                          </label>
                          <div className="px-3 py-2 rounded-lg bg-card border border-border text-xs font-mono text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {selected.integratePrompt || '(使用 SDK 默认)'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 用户可编辑部分：名称、emoji、颜色 */}
              <div className="space-y-4">
                <div className="flex gap-3 items-start">
                  <EmojiPicker value={emoji} onChange={setEmoji} />
                  <div className="flex-1">
                    <label className="block mb-0.5" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>空间名称 *</label>
                    <input
                      type="text" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="给空间起个名字"
                      className="w-full border-none outline-none bg-transparent"
                      style={{ borderBottom: '1.5px solid var(--color-pencil)', padding: '4px 2px', fontFamily: 'var(--font-hand)', fontSize: 17, color: 'var(--color-blue-pen)' }}
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1.5" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>空间颜色</label>
                  <ColorPicker value={color} onChange={setColor} />
                </div>
              </div>

              {error && <p className="rounded-lg px-3 py-2" style={{ fontFamily: 'var(--font-hand-alt)', fontSize: 14, color: 'var(--color-red-pen)', background: 'rgba(201,74,74,0.08)' }}>{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex justify-end gap-2" style={{ borderTop: '1px dashed rgba(42,42,42,0.12)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:opacity-70" style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--color-pencil)' }}>cancel</button>
          {selected && (
            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading}
              className="px-5 py-2 rounded-md border-none cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
              style={{ fontFamily: 'var(--font-hand)', fontSize: 16, backgroundColor: color, color: '#fff' }}
            >
              {loading ? 'creating...' : 'create from template'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── 自定义创建弹窗：所有字段可编辑 ─── */

function CustomCreateModal({
  presets,
  onClose,
  onCreated,
}: {
  presets: PresetConfig[]
  onClose: () => void
  onCreated: (meta: SpaceMeta) => void
}) {
  const [emoji, setEmoji] = useState('🧠')
  const [color, setColor] = useState('#6366f1')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<'AUTO' | 'PRO'>('AUTO')
  const [expectedArtifacts, setExpectedArtifacts] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')

  const [consolidatePrompt, setConsolidatePrompt] = useState('')
  const [integratePrompt, setIntegratePrompt] = useState('')

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedTab, setAdvancedTab] = useState<'sessions' | 'skills' | 'prompts'>('sessions')
  const [presetSessions, setPresetSessions] = useState<PresetSessionDraft[]>([])
  const [skills, setSkills] = useState<SkillDraft[]>([])

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 使用第一个 preset 作为 base（后端需要 presetDirName）
  const baseDirName = presets[0]?.dirName ?? ''

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const body: Parameters<typeof createSpace>[0] = {
        name: name.trim(),
        presetDirName: baseDirName,
        emoji,
        color,
        mode,
      }
      if (description.trim()) body.description = description.trim()
      if (expectedArtifacts.trim()) body.expectedArtifacts = expectedArtifacts.trim()
      if (systemPrompt.trim()) body.systemPrompt = systemPrompt.trim()
      if (consolidatePrompt.trim()) body.consolidatePrompt = consolidatePrompt.trim()
      if (integratePrompt.trim()) body.integratePrompt = integratePrompt.trim()
      const validSessions = presetSessions.filter((s) => s.name && s.label)
      if (validSessions.length > 0) {
        body.presetSessions = validSessions.map((s) => ({
          name: s.name, label: s.label,
          systemPromptMode: s.systemPromptMode,
          context: s.context,
          ...(s.systemPrompt && { systemPrompt: s.systemPrompt }),
          ...(s.consolidatePrompt && { consolidatePrompt: s.consolidatePrompt }),
          ...(s.guidePrompt && { guidePrompt: s.guidePrompt }),
          ...(s.activationHint && { activationHint: s.activationHint }),
        }))
      }
      const validSkills = skills.filter((s) => s.name && s.description && s.content)
      if (validSkills.length > 0) {
        body.skills = validSkills
      }
      const meta = await createSpace(body)
      onCreated(meta)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className={cn(
          'rounded-sm shadow-2xl flex max-h-[85vh] transition-all duration-300',
          showAdvanced ? 'w-[900px]' : 'w-[480px]',
        )}
        style={{ background: 'var(--color-paper)', transform: 'rotate(0.3deg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左栏：基础配置 */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="flex items-center gap-2 mb-5">
            <Wrench size={18} style={{ color: 'var(--color-blue-pen)' }} />
            <h2 style={{ fontFamily: 'var(--font-hand)', fontSize: 22, fontWeight: 600, color: 'var(--color-ink)' }}>Custom Create</h2>
          </div>

          <div className="space-y-4">
            {/* Emoji + 名称 */}
            <div className="flex gap-3 items-start">
              <EmojiPicker value={emoji} onChange={setEmoji} />
              <div className="flex-1">
                <label className="block mb-0.5" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>空间名称 *</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="给空间起个名字"
                  className="w-full border-none outline-none bg-transparent"
                  style={{ borderBottom: '1.5px solid var(--color-pencil)', padding: '4px 2px', fontFamily: 'var(--font-hand)', fontSize: 17, color: 'var(--color-blue-pen)' }}
                  autoFocus
                />
              </div>
            </div>

            {/* 颜色 */}
            <div>
              <label className="block mb-1.5" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>空间颜色</label>
              <ColorPicker value={color} onChange={setColor} />
            </div>

            {/* 系统提示词 */}
            <div>
              <label className="block mb-0.5" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>系统提示词</label>
              <textarea
                value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="定义 AI 助手的角色、工作方式和回答风格"
                rows={3}
                className="w-full border-none outline-none bg-transparent resize-none"
                style={{ borderBottom: '1.5px solid var(--color-pencil)', padding: '4px 2px', fontFamily: 'var(--font-hand-alt)', fontSize: 14, color: 'var(--color-ink)' }}
              />
              <p style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 10, color: 'var(--color-pencil)', marginTop: 2 }}>工具使用规则由框架自动注入，无需手动编写</p>
            </div>

            {/* 描述 */}
            <div>
              <label className="block mb-0.5" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>主题描述</label>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="你想探索什么话题？"
                rows={1}
                className="w-full border-none outline-none bg-transparent resize-none"
                style={{ borderBottom: '1.5px solid var(--color-pencil)', padding: '4px 2px', fontFamily: 'var(--font-hand-alt)', fontSize: 14, color: 'var(--color-ink)' }}
              />
            </div>

            {/* 预期产物 */}
            <div>
              <label className="block mb-0.5" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>预期产物（逗号分隔，可选）</label>
              <input
                value={expectedArtifacts} onChange={(e) => setExpectedArtifacts(e.target.value)}
                placeholder="PRD 文档, 技术方案, 竞品分析"
                className="w-full border-none outline-none bg-transparent"
                style={{ borderBottom: '1.5px solid var(--color-pencil)', padding: '4px 2px', fontFamily: 'var(--font-hand)', fontSize: 14, color: 'var(--color-ink)' }}
              />
            </div>

            {/* 模式 */}
            <div>
              <label className="block mb-1" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 12, color: 'var(--color-pencil)' }}>空间模式</label>
              <div className="flex gap-3">
                {(['AUTO', 'PRO'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className="flex-1 py-1.5 rounded-lg cursor-pointer border-2 transition-all"
                    style={{
                      fontFamily: 'var(--font-hand)', fontSize: 14,
                      borderColor: mode === m ? (m === 'AUTO' ? 'var(--color-blue-pen)' : 'var(--color-red-pen)') : 'rgba(42,42,42,0.1)',
                      background: mode === m ? (m === 'AUTO' ? 'rgba(58,107,197,0.08)' : 'rgba(201,74,74,0.08)') : 'transparent',
                      color: mode === m ? (m === 'AUTO' ? 'var(--color-blue-pen)' : 'var(--color-red-pen)') : 'var(--color-pencil)',
                    }}
                  >
                    <div className="font-semibold">{m}</div>
                    <div style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 11 }}>
                      {m === 'AUTO' ? 'AI 自动分裂节点' : '分裂前请求确认'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 高级配置展开按钮 */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer transition-colors hover:opacity-70"
              style={{ fontFamily: 'var(--font-hand)', fontSize: 14, color: 'var(--color-pencil)' }}
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              高级配置（预设节点 & 技能 & 记忆提炼）
              {(presetSessions.length > 0 || skills.length > 0 || consolidatePrompt || integratePrompt) && (
                <span className="px-1.5 rounded-full" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 10, background: 'rgba(58,107,197,0.08)', color: 'var(--color-blue-pen)' }}>
                  {presetSessions.length + skills.length + (consolidatePrompt ? 1 : 0) + (integratePrompt ? 1 : 0)}
                </span>
              )}
            </button>

            {error && <p className="rounded-lg px-3 py-2" style={{ fontFamily: 'var(--font-hand-alt)', fontSize: 14, color: 'var(--color-red-pen)', background: 'rgba(201,74,74,0.08)' }}>{error}</p>}
          </div>

          {/* 底部按钮 */}
          <div className="flex justify-end gap-2 mt-6 pt-4" style={{ borderTop: '1px dashed rgba(42,42,42,0.12)' }}>
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-transparent border-none cursor-pointer transition-colors hover:opacity-70" style={{ fontFamily: 'var(--font-hand)', fontSize: 15, color: 'var(--color-pencil)' }}>cancel</button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading}
              className="px-5 py-2 rounded-md border-none cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
              style={{ fontFamily: 'var(--font-hand)', fontSize: 16, backgroundColor: color, color: '#fff' }}
            >
              {loading ? 'creating...' : 'create space'}
            </button>
          </div>
        </div>

        {/* 右栏：高级配置（可折叠） */}
        {showAdvanced && (
          <div className="w-[400px] p-5 overflow-y-auto" style={{ borderLeft: '1px dashed rgba(42,42,42,0.12)', background: 'rgba(42,42,42,0.02)' }}>
            <h3 className="mb-3" style={{ fontFamily: 'var(--font-hand)', fontSize: 18, fontWeight: 600, color: 'var(--color-ink)' }}>高级配置</h3>

            <div className="flex border-b border-border mb-4">
              {([
                { key: 'sessions' as const, label: '预设节点' },
                { key: 'skills' as const, label: '技能' },
                { key: 'prompts' as const, label: '记忆提炼' },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setAdvancedTab(tab.key)}
                  className={cn(
                    'px-3 py-2 text-xs font-medium transition-colors',
                    advancedTab === tab.key
                      ? 'text-primary border-b-2 border-primary'
                      : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {tab.label}
                  {tab.key === 'sessions' && presetSessions.length > 0 && (
                    <span className="ml-1 text-[10px] bg-primary-light text-primary px-1.5 rounded-full">{presetSessions.length}</span>
                  )}
                  {tab.key === 'skills' && skills.length > 0 && (
                    <span className="ml-1 text-[10px] bg-primary-light text-primary px-1.5 rounded-full">{skills.length}</span>
                  )}
                  {tab.key === 'prompts' && (consolidatePrompt || integratePrompt) && (
                    <span className="ml-1 text-[10px] bg-primary-light text-primary px-1.5 rounded-full">✓</span>
                  )}
                </button>
              ))}
            </div>

            {advancedTab === 'sessions' && (
              <div>
                <p className="text-[10px] text-text-muted mb-3">
                  预设节点在 Fork 模式中显示为待点亮的节点。每个节点注册为 ForkProfile，AI 可通过 stello_create_session 工具激活。
                </p>
                <PresetSessionEditor sessions={presetSessions} onChange={setPresetSessions} />
              </div>
            )}
            {advancedTab === 'skills' && (
              <div>
                <p className="text-[10px] text-text-muted mb-3">
                  技能是可被 AI 激活的 prompt 片段。AI 通过 activate_skill 工具按需加载。
                </p>
                <SkillEditor skills={skills} onChange={setSkills} />
              </div>
            )}
            {advancedTab === 'prompts' && (
              <div className="space-y-4">
                <p className="text-[10px] text-text-muted">
                  自定义 L3→L2 提炼和跨 Session 集成的提示词。留空则使用 SDK 默认提示词。
                </p>
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Consolidate Prompt
                    <span className="ml-1 text-[10px] font-normal">（L3 对话 → L2 摘要）</span>
                  </label>
                  <textarea
                    value={consolidatePrompt}
                    onChange={(e) => setConsolidatePrompt(e.target.value)}
                    placeholder={'留空使用默认：\n将以下对话记录提炼为一段简洁的摘要...'}
                    rows={5}
                    className="w-full px-2 py-2 rounded border border-border bg-card text-xs font-mono placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    Integrate Prompt
                    <span className="ml-1 text-[10px] font-normal">（所有 L2 → synthesis + insights）</span>
                  </label>
                  <textarea
                    value={integratePrompt}
                    onChange={(e) => setIntegratePrompt(e.target.value)}
                    placeholder={'留空使用默认：\n基于以下各子 Session 的摘要，生成综合认知和定向洞察...'}
                    rows={5}
                    className="w-full px-2 py-2 rounded border border-border bg-card text-xs font-mono placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Kit Space 列表页 ─── */

export function SpaceList() {
  const navigate = useNavigate()
  type Tab = 'spaces' | 'market'
  const [tab, setTab] = useState<Tab>('spaces')
  const [spaces, setSpaces] = useState<SpaceMeta[]>([])
  const [presets, setPresets] = useState<PresetConfig[]>([])
  const [marketSelected, setMarketSelected] = useState<PresetConfig | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    fetchSpaces().then(setSpaces).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    fetchPresets().then(setPresets)
  }, [refresh])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除「${name}」？`)) return
    await deleteSpace(id)
    refresh()
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--color-paper)' }}>
      {/* 顶部导航 — 笔记本风格 tab 栏 */}
      <nav className="flex items-center pt-8 pb-4 px-5" style={{ fontFamily: 'var(--font-hand)', fontSize: 26, marginBottom: 8 }}>
        <span className="text-[36px] font-bold shrink-0" style={{ color: 'var(--color-ink)', transform: 'rotate(-2deg)', display: 'inline-block' }}>
          MindKit
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-8">
          {([
            { key: 'spaces' as Tab, label: 'Kit Spaces' },
            { key: 'market' as Tab, label: 'Kit Market' },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="relative bg-transparent border-none cursor-pointer py-1 px-1 transition-all"
              style={{
                fontFamily: 'var(--font-hand)', fontSize: 24,
                color: tab === t.key ? 'var(--color-ink)' : 'var(--color-pencil)',
              }}
            >
              {tab === t.key && (
                <span className="absolute left-0 right-0 -bottom-1 h-[3px] rounded-full" style={{ background: 'var(--color-blue-pen)', opacity: 0.35 }} />
              )}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
      </nav>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex justify-center pb-8" style={{ paddingTop: 16 }}>
        {/* ─── Kit Spaces tab ─── */}
        {tab === 'spaces' && (
          <div className="w-full max-w-3xl px-6">
            {/* 标题区 */}
            <div className="flex items-end justify-between mb-6">
              <div>
                <h1 className="text-[32px] font-bold" style={{ fontFamily: 'var(--font-hand)', color: 'var(--color-ink)', transform: 'rotate(-1deg)', display: 'inline-block' }}>
                  My Space
                </h1>
                <p style={{ fontFamily: 'var(--font-hand-alt)', fontSize: 16, color: 'var(--color-pencil)', marginTop: 2 }}>
                  你的 AI 认知空间集合
                </p>
              </div>
              <button onClick={() => setShowCustom(true)}
                className="flex items-center gap-2 rounded-lg cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98] border-none"
                style={{ fontFamily: 'var(--font-hand)', fontSize: 17, padding: '8px 10px', background: 'var(--color-blue-pen)', color: '#fff' }}
              >
                <Plus size={18} />
                创建新空间
              </button>
            </div>

            {loading ? (
              <div className="text-center py-20" style={{ color: 'var(--color-pencil)', fontFamily: 'var(--font-hand-alt)', fontSize: 16 }}>loading...</div>
            ) : spaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--color-pencil)' }}>
                <GitBranch size={48} className="mb-4 opacity-30" />
                <p style={{ fontFamily: 'var(--font-hand)', fontSize: 24, color: 'var(--color-pencil)', marginBottom: 16 }}>还没有任何空间</p>
                <button onClick={() => setShowCustom(true)}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg cursor-pointer transition-transform hover:scale-[1.02] border-none mb-4"
                  style={{ fontFamily: 'var(--font-hand)', fontSize: 20, background: 'var(--color-blue-pen)', color: '#fff' }}
                >
                  <Plus size={20} /> 创建你的第一个 Kit
                </button>
                <button onClick={() => setTab('market')}
                  className="bg-transparent border-none cursor-pointer underline"
                  style={{ fontFamily: 'var(--font-hand-alt)', fontSize: 16, color: 'var(--color-blue-pen)' }}
                >
                  或去 Kit Market 探索模板
                </button>
              </div>
            ) : (
              <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                {spaces.map((s, idx) => (
                  <div key={s.id} onClick={() => navigate(`/kit/${s.id}`)}
                    className="sticky-note tape-top relative cursor-pointer transition-transform hover:scale-[1.03] group"
                    style={stickyStyle(idx, { minHeight: 180 })}
                  >
                    <span className="tape" style={{ transform: `translateX(-50%) rotate(${TAPE_ROTATIONS[idx % TAPE_ROTATIONS.length]})` }} />
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[24px]">{s.emoji}</span>
                      <h3 className="text-[24px] font-semibold truncate" style={{ fontFamily: 'var(--font-hand)', color: 'var(--color-blue-pen)' }}>
                        {s.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 rounded-full" style={{
                        fontFamily: 'var(--font-hand-sm)', fontSize: 11,
                        background: s.mode === 'AUTO' ? 'rgba(58,107,197,0.1)' : 'rgba(201,74,74,0.1)',
                        color: s.mode === 'AUTO' ? 'var(--color-blue-pen)' : 'var(--color-red-pen)',
                        border: `1px solid ${s.mode === 'AUTO' ? 'rgba(58,107,197,0.2)' : 'rgba(201,74,74,0.2)'}`,
                      }}>
                        {s.mode}
                      </span>
                    </div>
                    {s.description && (
                      <p className="mb-3 line-clamp-2" style={{ fontFamily: 'var(--font-hand-alt)', fontSize: 15, color: 'var(--color-ink)', lineHeight: 1.6 }}>
                        {s.description}
                      </p>
                    )}
                    {s.expectedArtifacts && (
                      <p className="mb-2 line-clamp-1" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 11, color: 'var(--color-pencil)' }}>
                        📎 {s.expectedArtifacts}
                      </p>
                    )}
                    <div className="flex items-center gap-3" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 13, color: 'var(--color-pencil)' }}>
                      <span>{new Date(s.createdAt).toLocaleDateString('zh-CN')}</span>
                      {s.presetSessions && s.presetSessions.length > 0 && (
                        <span style={{ color: 'var(--color-blue-pen)' }}>
                          · {Object.keys(s.activatedPresets ?? {}).length}/{s.presetSessions.length} lit
                        </span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id, s.name) }}
                        className="ml-auto bg-transparent border-none cursor-pointer opacity-0 group-hover:opacity-60 transition-opacity p-1"
                        style={{ color: 'var(--color-red-pen)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Kit Market tab ─── */}
        {tab === 'market' && (
          <div className="w-full max-w-4xl px-6 mx-auto">
            <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {presets.map((p, idx) => (
                <div
                  key={p.dirName}
                  className="sticky-note tape-top relative flex flex-col overflow-hidden transition-transform hover:scale-[1.03]"
                  style={stickyStyle(idx, { minHeight: 200 })}
                >
                  <span className="tape" style={{ transform: `translateX(-50%) rotate(${TAPE_ROTATIONS[idx % TAPE_ROTATIONS.length]})` }} />
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-[20px] font-semibold" style={{ fontFamily: 'var(--font-hand)', color: 'var(--color-blue-pen)' }}>
                      {p.emoji} {p.name}
                    </h3>
                    <div className="flex gap-1.5 shrink-0 mt-1">
                      <span className="px-2 py-0.5 rounded-full" style={{
                        fontFamily: 'var(--font-hand-sm)', fontSize: 11, lineHeight: '16px',
                        background: p.mode === 'AUTO' ? 'rgba(58,107,197,0.1)' : 'rgba(201,74,74,0.1)',
                        color: p.mode === 'AUTO' ? 'var(--color-blue-pen)' : 'var(--color-red-pen)',
                        border: `1px solid ${p.mode === 'AUTO' ? 'rgba(58,107,197,0.2)' : 'rgba(201,74,74,0.2)'}`,
                      }}>
                        {p.mode}
                      </span>
                    </div>
                  </div>
                  <p className="mb-4" style={{ fontFamily: 'var(--font-hand-alt)', fontSize: 16, color: 'var(--color-ink)', lineHeight: 1.5 }}>
                    {p.description}
                  </p>
                  <div className="flex flex-col gap-3 mt-auto pt-2" style={{ borderTop: '1px dashed rgba(42,42,42,0.12)' }}>
                    <div className="flex gap-2">
                      {p.forkProfiles.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 11, background: 'rgba(42,42,42,0.06)', color: 'var(--color-pencil)' }}>
                          {p.forkProfiles.length} preset nodes
                        </span>
                      )}
                      {p.skills.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded" style={{ fontFamily: 'var(--font-hand-sm)', fontSize: 11, background: 'rgba(42,42,42,0.06)', color: 'var(--color-pencil)' }}>
                          {p.skills.length} skills
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setMarketSelected(p)}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-md cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98] border-none"
                      style={{ fontFamily: 'var(--font-hand)', fontSize: 18, background: 'var(--color-blue-pen)', color: '#fff' }}
                    >
                      <Store size={16} />
                      应用
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Market 选中后的创建弹窗 */}
      {marketSelected && (
        <MarketModal
          presets={presets}
          initialSelected={marketSelected}
          onClose={() => setMarketSelected(null)}
          onCreated={(meta) => navigate(`/kit/${meta.id}`)}
        />
      )}

      {showCustom && presets.length > 0 && (
        <CustomCreateModal
          presets={presets}
          onClose={() => setShowCustom(false)}
          onCreated={(meta) => navigate(`/kit/${meta.id}`)}
        />
      )}
    </div>
  )
}
