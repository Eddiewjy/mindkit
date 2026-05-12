/**
 * 共享基础配置 — 与具体 preset 无关的框架级指令。
 * space-factory 在组装 systemPrompt 时自动追加。
 */

/** 框架级 system prompt 后缀：tool 使用规则（所有 space 共享） */
export const BASE_SYSTEM_SUFFIX = `

## 工具使用规则
- 当识别到一个独立的子话题，**必须立即调用** stello_create_session
- 如果有合适的 profile，优先使用 profile（会自动配置系统提示词和工具）
- 没有合适 profile 时，提供 label 和 systemPrompt 创建自由子会话
- 可以提供 prompt 作为子会话的第一条 assistant 开场消息，帮助它立即进入工作状态
- 不要等用户明确要求，根据对话上下文主动判断
`.trim()
