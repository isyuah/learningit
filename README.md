# 知学 · 多课程教学平台模板（Learning Template）

> 基于 **React 19 + Tailwind CSS v4** 的数据驱动 Learning Platform。平台负责统一 UI、导航、搜索、进度和教学组件；课程内容按“一门课一个目录、一节课一个文件”写入 `src/content/courses/`。

![stack](https://img.shields.io/badge/React-19-274e41) ![tailwind](https://img.shields.io/badge/Tailwind_CSS-v4-2f5e4d) ![license](https://img.shields.io/badge/license-MIT-c9a24b)

## ✨ 特性

- **多课程集中管理**：不同课程共享同一套平台能力和视觉系统。
- **内容即数据**：课程与课时都是结构化 TypeScript 数据；文件放入约定目录即可自动加载。
- **一门课一个目录、一节课一个文件**：天然适合持续维护，也适合多个 Agent 在明确所有权下并行写不同课时。
- **教学组件库**：正文、代码、提示、表格、测验、练习、术语、视频、课程大纲、课时导航等。
- **零后端、纯静态**：页面、路由和本地进度记录已就绪，可直接部署到静态托管。
- **校验工具**：`npm run validate` 检查文件名 slug、大纲一致性、Quiz 等内容约束。
- **站内搜索**：`Ctrl/Cmd + K` 搜索课程与课时。
- **可换肤 + 暗色模式**：设计令牌集中在 `src/index.css`。
- **AI / LLM 友好**：平台契约、内容写入指南、组件文档和 fallback Prompt 分离；可与专门的课程创作 Skill 配合。
- **边学边问**：课时页提供可配置的 OpenAI-compatible 学习助手，支持课程上下文、当前小节、对话历史和本地持久化；详见 [`docs/AI-ASSISTANT.md`](docs/AI-ASSISTANT.md)。

## 🚀 快速开始

要求：Node.js ≥ 20.19

```bash
npm install
npm run dev
npm run validate
npm run typecheck
npm run build
npm run preview
npm run scaffold:course -- --slug my-course --title "我的课程"
```

## 📁 目录结构

```text
learningTemplate/
├── src/
│   ├── content/
│   │   ├── site.ts
│   │   ├── types.ts                # Course / LessonMeta / LessonBlock 权威类型（课时元信息以大纲为准）
│   │   └── courses/
│   │       ├── index.ts            # 自动聚合入口，一般不改
│   │       └── <course-slug>/
│   │           ├── course.ts       # 课程信息 + 章节/课时大纲
│   │           └── lessons/
│   │               └── <lesson-slug>.ts
│   ├── components/
│   │   ├── ui/
│   │   ├── learning/
│   │   └── layout/
│   ├── pages/
│   ├── lib/
│   └── index.css
├── scripts/
│   ├── validate.ts
│   └── scaffold-course.mjs
└── docs/
    ├── AGENTS.md
    ├── PLATFORM-CONTRACT.md
    ├── CONTENT-AUTHORING.md
    ├── COMPONENTS.md
    ├── DESIGN.md
    ├── AI-ASSISTANT.md
    └── LLM-PROMPT.md
```

## 📚 文档职责

| 文档 | 负责什么 |
| --- | --- |
| `docs/PLATFORM-CONTRACT.md` | **平台硬约束**：目录、自动发现、slug、文件名、courseSlug、校验、写入边界 |
| `docs/CONTENT-AUTHORING.md` | **内容落地**：如何建课程、写课时、按教学需要选择 LessonBlock |
| `docs/COMPONENTS.md` | **平台能力**：现有 UI / 教学组件与 API |
| `docs/DESIGN.md` | **视觉系统**：设计令牌、字体、暗色模式、换肤 |
| `docs/AGENTS.md` | **AI 仓库操作规范**：课程任务与平台任务边界、多 Agent 所有权 |
| `docs/LLM-PROMPT.md` | **备用方案**：没有专门课程创作 Skill 时的 standalone Prompt |

如果当前环境安装了课程创作 Skill：

```text
Skill
→ 负责学习目标、研究、知识建模、课程策划、写作策略、Subagent 协作、Reviewer

Project docs
→ 负责当前平台真实能怎么写、有哪些硬约束、有哪些组件
```

## ✍️ 新增一门课程

### 1. 创建骨架

```bash
npm run scaffold:course -- --slug gorm --title "GORM 系统学习"
```

### 2. 策划大纲

编辑：

```text
src/content/courses/gorm/course.ts
```

课程大纲可以先完整建立，即使部分课时尚未写正文。

### 3. 写课时

每节课一个文件：

```text
src/content/courses/gorm/lessons/gorm-query-basics.ts
src/content/courses/gorm/lessons/gorm-transactions.ts
...
```

### 4. 校验

```bash
npm run validate
npm run typecheck
npm run build
```

详细写法见 `docs/CONTENT-AUTHORING.md`。

## 🤖 多 Agent 课程生产

对于大型课程，如果所用 harness 支持 Subagent，可以采用：

```text
Planner / Lead
    ↓
course.ts + lesson slug 分配
    ↓
Author A ─┐
Author B ─┼─→ Reviewer / Integrator → validate / build
Author C ─┘
```

Planner 负责课程结构；Author 分别写互不冲突的 lesson 文件；Reviewer 负责跨章节一致性和最终验证。详细约定见 `docs/AGENTS.md`。

## ⚠️ 当前重要平台约束

- 课时元信息（标题/时长/类型/顺序）以 `course.ts` 大纲 `LessonMeta` 为**权威**；
  课时文件里重复的 `slug/title/minutes/kind` 等只是可选冗余声明，务必与大纲一致
  （`npm run validate` 会把不一致判为错误）。
- 课时文件名即课时真实 slug，被聚合为跨课程的全局映射，因此 **文件名 slug 必须
  跨课程全局唯一**。

推荐：

```text
gorm-transactions
redis-persistence
os-process-scheduling
```

而不是让多门课程都使用 `introduction`、`basics` 等重复 slug。

完整硬约束见 `docs/PLATFORM-CONTRACT.md`。

## 🛠 技术栈

- React 19 + Vite 8
- Tailwind CSS v4
- React Router 7
- lucide-react
- Shiki
- TypeScript
- 字体：Noto Sans SC / Manrope / JetBrains Mono（代码）

## 🎨 设计

平台视觉系统与课程内容解耦。字体、颜色、圆角、阴影、明暗主题等由平台统一维护，课程作者通常无需修改 UI。

详细见 `docs/DESIGN.md`。

## 📄 License

MIT
