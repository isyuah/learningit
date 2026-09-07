# AGENTS.md — AI 编程与课程创作助手仓库说明

> 在修改本仓库前先阅读本文件。若任务涉及课程内容，再阅读：
>
> 1. `docs/PLATFORM-CONTRACT.md`
> 2. `docs/CONTENT-AUTHORING.md`
> 3. `src/content/types.ts`
> 4. 需要使用具体内容块时，再查 `docs/COMPONENTS.md`
>
> 如果环境中安装了专门的课程创作 Skill，应让 Skill 负责教学策划、研究、知识结构与审校；本仓库文档负责平台事实和写入约束。

## 1. 这个项目是什么

这是一个数据驱动的多课程 Learning Platform：React 19 + Tailwind CSS v4 + React Router 7 + Vite 8。

平台层负责 UI、路由、搜索、进度、主题和内容块渲染；课程层负责课程大纲与课时内容。

```text
Platform
├── UI / Layout / Search / Progress / Theme
└── LessonBlock Rendering

Content
└── src/content/courses/<course-slug>/**
```

普通“新增课程 / 写课程 / 更新课程”任务，优先只修改内容层，而不是重新设计网站。

## 2. 文档职责

- `PLATFORM-CONTRACT.md`：平台硬约束；数据如何才能正确运行。
- `CONTENT-AUTHORING.md`：如何创建课程、课时和选择内容块。
- `COMPONENTS.md`：现有 UI / 教学组件能力与 API。
- `DESIGN.md`：平台视觉系统与换肤方式。
- `LLM-PROMPT.md`：未安装课程创作 Skill 时的 standalone fallback。

不要把 `LLM-PROMPT.md` 中的写作建议当作比类型契约更高的规则。

## 3. 命令

```bash
npm install
npm run dev
npm run validate
npm run typecheck
npm run build
npm run preview
npm run scaffold:course -- --slug my-course --title "我的课程"
```

修改 `src/content/` 后必须运行 `npm run validate`。交付前应通过 `npm run build`。

## 4. 仓库地图

```text
src/content/
  site.ts
  types.ts
  courses/
    index.ts
    <course-slug>/
      course.ts
      lessons/*.ts

src/components/
  ui/
  learning/
  layout/

src/pages/
src/lib/
scripts/
docs/
```

课程和课时通过 `import.meta.glob` 自动发现，不要为新增课程手工维护全局注册表。

## 5. 普通课程任务的写入边界

### 默认可修改

```text
src/content/courses/<target-course>/**
```

### 视任务需要修改

```text
src/content/site.ts
```

### 默认保护

```text
src/content/types.ts
src/content/courses/index.ts
src/components/**
src/pages/**
src/index.css
src/App.tsx
scripts/**
```

如果现有平台无法表达课程真正需要的内容，不要由单个章节作者顺手修改平台。记录为 **Platform Capability Gap**，由负责集成/平台的 Agent 或开发任务统一处理。

## 6. 课程创建与内容约束

平台硬约束全部见 `docs/PLATFORM-CONTRACT.md`。尤其注意：

- 一门课一个目录，一节课一个文件。
- **文件名即课时真实 slug**，且课时元信息（标题/时长/类型）以大纲 `LessonMeta`
  为权威：改标题/时长/顺序只改 `course.ts` 大纲，不要为展示用途改课时文件。
- 课时文件内如出现 `slug/courseSlug/title/minutes/kind` 冗余声明，必须与文件名/
  大纲一致（`npm run validate` 交叉检查，不一致判错）。
- **当前版本课时文件 slug 跨课程全局唯一。**
- `src/content/types.ts` 是 block 字段的权威定义，不得发明未定义字段。

## 7. 多 Agent / Subagent 课程生产

如果当前 harness 支持 Subagent，并且课程规模值得并行，可以采用：

```text
Planner / Lead
    ↓
课程目标 + Knowledge Map + course.ts
    ↓
冻结本轮课程大纲与写作契约
    ↓
Author A / Author B / Author C ...
    ↓
Reviewer / Integrator
    ↓
validate + typecheck + build + 内容审校
```

### 7.1 Planner / Lead

Planner 负责：

- 理解用户要求、学习对象和学习目标；
- 设计课程知识结构与章节顺序；
- 创建或更新 `course.ts`；
- 分配 lesson slug 与作者写入范围；
- 在并行创作前冻结当前批次的大纲。

### 7.2 Author

每个 Author 只拥有明确分配的 `lessons/<slug>.ts` 文件。

Author 不应：

- 擅自修改 `course.ts`；
- 重命名其他 Author 的 lesson slug；
- 修改平台层文件；
- 为了视觉多样性强行加入无教学价值的 block。

如果发现课程结构需要改变，向 Planner / Integrator 提出结构问题，而不是在自己的课时里自行重构全局课程。

### 7.3 Reviewer / Integrator

Reviewer / Integrator 负责：

- 检查章节之间是否重复、断层或前后矛盾；
- 检查术语、命名、难度和前置知识是否一致；
- 检查重要知识是否缺失；
- 必要时统一调整 `course.ts`；
- 检查平台约束；
- 运行 `npm run validate`、`npm run typecheck`、`npm run build`。

### 7.4 小任务不要强制多 Agent

单节课、小型专题或低复杂度修改可以由一个 Agent 完成。Subagent 是并行生产手段，不是完成任务的仪式。

## 8. 教学内容原则

具体教学策略优先由课程创作 Skill 决定。没有 Skill 时，至少遵守：

- 学习网站不是 Landing Page；正文必须真正承担教学。
- 先回答知识问题，再选择展示 block。
- 不规定每节课必须有固定数量的 blocks。
- 不规定每节课必须覆盖固定数量的 block 类型。
- `keypoints`、`quiz`、`exercise`、`callout` 等只在有教学价值时使用。
- 代码示例必须尽量真实、完整并符合当前主题的技术语义。
- 不确定的版本行为、API、仓库设计原因不得凭空断言；应研究来源或明确标注推断。

## 9. 平台开发约定

- 路径别名：`@/` → `src/`。
- 类名合并使用 `cn()`（`@/lib/utils`）。
- 图标使用 `lucide-react`，不要为了单个需求引入第二套图标库。
- UI 默认简体中文。
- 修改全局设计令牌时同时检查亮色/暗色模式。
- 新增 LessonBlock 类型时至少同步修改：
  1. `src/content/types.ts`
  2. `src/components/learning/lesson-blocks.tsx`
  3. `docs/COMPONENTS.md`
  4. `docs/CONTENT-AUTHORING.md`
  5. 需要时扩展 `scripts/validate.ts`

## 10. 交付前检查

课程内容任务：

```bash
npm run validate
npm run typecheck
```

平台或综合任务：

```bash
npm run build
```

如果 validate 只有“尚未写内容的占位课时”警告，应确认它们是否是当前计划中的未完成课时，而不是直接忽略。
