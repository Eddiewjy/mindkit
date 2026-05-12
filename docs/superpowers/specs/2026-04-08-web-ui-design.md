# MindKit Web UI 设计文档

> 用于测试后端的功能性前端，快速实用为主。

## 本轮实现范围

### 1. Kit Space 列表页 (`/`)

- Kit 卡片网格（名称、描述、节点数、消息数）
- "创建新空间" 按钮 → 弹出 Modal（名称、描述、模式 AUTO/PRO）
- 点击卡片进入工作界面
- 数据用 localStorage mock，后端就绪后换 API

### 2. Kit 工作界面 (`/kit/:id`)

- 左右对半分
- **左侧：对话面板** — 消息列表 + 底部输入框，显示当前节点的对话历史
- **右侧：节点拓扑图** — 复用 stello devtools 的 Canvas 拓扑方案（同心圆布局），点击节点切换左侧对话
- 顶栏：返回 Space + Kit 名称

### 3. 数据层

- React Context + useReducer
- Mock 数据结构对齐后端 API 的 Space/Session 模型
- 方便后续切换为真实 API

### 技术栈

- React 19 + Vite + TailwindCSS v4
- React Router v7
- Lucide React icons
- HTML5 Canvas（拓扑图）

---

## 后续需要完成（本轮不做）

### UI 功能

- [ ] Kit Market（广场）— 浏览、搜索、Fork 他人的 Kit
- [ ] Kit Workshop（工坊）— Kit 模板编辑器
- [ ] 涂鸦手绘风格（Doodle/Hand-drawn）— 手绘节点、手写字体、黑板背景
- [ ] 产物视图（Artifact View）— 展示 Kit 中已生成的结构化产物
- [ ] 事件流视图（Event Stream View）— 时间线展示系统事件
- [ ] 摘要/洞察 Tab — 节点摘要 + 主节点 insight 推送
- [ ] 高级配置面板 — LLM/Session/Scheduler/Capabilities/Runtime/Hooks
- [ ] Kit 设置面板 — 基础信息编辑、模式切换
- [ ] 跨节点关联/矛盾标注 — 蓝色关联线、红色矛盾线、hover 说明
- [ ] 分裂动画 — 新节点涂鸦生长动画
- [ ] 完成进度 — 模板类 Kit 的节点完成度
- [ ] Fork 模板模式 — 未激活节点暗色/虚线，AI 自动点亮

### 后端对接

- [ ] 替换 localStorage mock 为真实 REST API
- [ ] WebSocket 对接 — 流式对话
- [ ] 实时事件流（WebSocket events）
