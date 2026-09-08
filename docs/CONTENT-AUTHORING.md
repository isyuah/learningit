# CONTENT-AUTHORING.md — 课程内容写入指南

> 本文只解决“如何把已经策划好的课程正确写入当前 Learning Platform”。
> 课程为什么这样组织、应该讲什么、不同学习对象应该采用什么教学策略，优先由课程创作 Skill 或课程作者决定。
>
> 平台硬约束先读 `docs/PLATFORM-CONTRACT.md`；数据类型以 `src/content/types.ts` 为准。

## 0. 内容数据流

```text
src/content/site.ts
        ↓
站点公共文案

src/content/courses/<course-slug>/course.ts
        ↓
课程信息 + 章节/课时大纲

src/content/courses/<course-slug>/lessons/*.ts
        ↓
完整课时 Lesson

src/content/courses/index.ts
        ↓
自动发现并聚合

pages + learning components
        ↓
渲染为课程页 / 课时页
```

课程和课时采用约定式自动加载。新文件放入正确目录即可，不需要修改索引。

## 1. 创建课程

推荐：

```bash
npm run scaffold:course -- --slug my-course --title "我的课程" --tagline "一句话副标题"
```

可选：

```bash
--level beginner|intermediate|advanced
--hours 8
```

生成：

```text
src/content/courses/my-course/
├── course.ts
└── lessons/
    └── lesson-1.ts
```

如果课程由 AI / Subagent 批量生产，建议先由 Planner 完成 `course.ts`，冻结当前批次大纲后再并行写各 lesson 文件。

## 2. 编写 course.ts

```ts
import type { Course } from "../../types";

export const course: Course = {
  slug: "gorm",
  title: "GORM 系统学习",
  tagline: "从正确使用到工程实践",
  description: "面向已经掌握 Go 与 SQL 的学习者。",
  level: "intermediate",
  hours: 10,
  coverIndex: "01",
  coverColor: "primary",
  updatedAt: "2026-08",
  outcomes: [
    "建立 GORM 的核心心智模型",
    "掌握常用查询、关联与事务",
    "理解真实后端项目中的常见陷阱与工程实践",
  ],
  chapters: [
    {
      id: "foundation",
      title: "基础与心智模型",
      intro: "先理解 GORM 如何连接 Go 对象与数据库操作。",
      lessons: [
        {
          slug: "gorm-mental-model",
          title: "GORM 的核心心智模型",
          minutes: 18,
          kind: "reading",
        },
      ],
    },
  ],
};
```

注意：

- 课程目录名建议与 `course.slug` 一致。
- `chapters` 的数组顺序就是课程学习顺序。
- 当前平台要求 lesson slug 跨课程全局唯一，详见 `PLATFORM-CONTRACT.md`。
- 大纲可以先包含尚未写内容的课时，平台会显示占位状态。
- **大纲是本课程的「课时元信息权威」**：课时文件的标题、时长、类型、顺序都以
  大纲 `LessonMeta` 为准。改课时标题/时长/顺序 = 只改 `course.ts`，不需要动
  对应课时文件（详情见下一节）。

## 3. 编写课时文件

文件：

```text
src/content/courses/gorm/lessons/gorm-mental-model.ts
```

示例：

```ts
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "理解 GORM 在应用代码与数据库之间承担的职责。",
  blocks: [
    {
      type: "paragraph",
      text: "使用 ORM 之前，先把它看成一层负责对象映射、SQL 构造与数据库交互的抽象，而不是把数据库本身隐藏掉。",
    },
    {
      type: "heading",
      text: "GORM 解决的核心问题",
    },
    {
      type: "list",
      items: [
        "把 Go 结构体映射到数据库表与字段",
        "把常见数据操作表达成可组合的 Go API",
        "管理关联、事务、迁移等数据库工作流",
      ],
    },
  ],
};
```

课时文件职责：

- 课时元信息（标题、时长、类型）**不写在这里**：一律以 `course.ts` 大纲 `LessonMeta` 为权威（标题修改只改大纲）。
- `summary` 与 `blocks` 是课时独有字段，写在本文件。
- 文件内出现 `slug/courseSlug/title/minutes/kind` 等冗余声明时，必须与大纲一致（`npm run validate` 交叉检查，不一致报错）。

硬约束：

- **文件名 = 课时 slug**（权威键），并必须出现在 `course.ts` 大纲中，课时才进入学习路径。
- 课时文件 slug 跨课程全局唯一（与大纲 LessonMeta.slug 是同一个值）。

## 4. 如何选择 LessonBlock

不要先想“这一节要凑多少种组件”，而应该先问：**当前知识最适合怎样表达？**

| Block | 适合表达 | 不应为了什么使用 |
| --- | --- | --- |
| `paragraph` | 连贯解释、机制、推理、上下文 | 只因为页面看起来空 |
| `heading` / `subheading` | 真正的知识层级 | 把每两段文字都拆成标题 |
| `list` | 并列项、步骤摘要、检查项 | 替代需要解释的正文 |
| `callout` | 容易错过的提醒、坑、版本差异、关键例外 | 普通信息高亮、装饰 |
| `code` | API、语法、真实实现、可执行示例 | 只有伪代码价值却冒充可运行代码 |
| `table` | 多维对比、参数矩阵、结构化参考 | 只有一两个简单差异 |
| `definition` | 需要明确固定含义的术语 | 普通名词 |
| `keypoints` | 阶段总结、复习、压缩重点 | 强制每课出现 |
| `quiz` | 主动回忆、概念辨析、理解检验 | 仅为了互动效果 |
| `exercise` | 需要学习者实际操作、推导或编程 | 已经在正文直接给出答案的形式题 |
| `video` | 视频本身有教学价值 | 纯装饰占位 |
| `quote` | 原始定义、规范或值得保留的短引文 | 伪造权威感 |
| `divider` | 明确的内容阶段切换 | 高频视觉分割 |

一节课可以主要由正文和代码构成，也可以包含表格、练习、测验等。**不存在固定 block 数量或固定 block 类型配额。**

## 5. 行内 Markdown 与术语引用

叙事字段在渲染前会经过**行内 Markdown** 解析（规则实现与校验共用 `src/lib/inline-markdown.ts`）。叙事字段指：

| 块 | 支持行内 Markdown 的字段 | 保持纯文本的字段（出现记号会警告） |
| --- | --- | --- |
| `paragraph` | `text` | — |
| `list` | `items` | — |
| `callout` | `title`、`body` | — |
| `table` | `rows`（单元格） | `caption`、`headers` |
| `definition` | `definition` | `term` |
| `keypoints` | `items` | — |
| `quiz` | `question`、`options`、`explanation` | — |
| `exercise` | `description`、`hint` | — |
| `quote` | `text` | `source` |
| `heading` / `subheading` | — | `text`（目录锚点） |

### 支持语法

```text
**加粗**        *斜体*          ~~删除线~~        `行内代码`
[文字](https://example.com)    外链（新窗口打开；http/https/mailto）
[文字](/courses/gorm/lessons/x) 站内链接（不刷新页面）
[文字](glossary:term-key)       术语引用（悬浮/点击固定简介卡片，卡片内进术语页锚点）
<https://example.com>           尖括号自动链接
\* 转义                        行尾两个空格 + 换行 = 强制换行（其余换行折叠为空格）
```

- 链接 scheme 白名单：`http:` / `https:` / `mailto:` / 站内 `/` 路径 / `glossary:`。
  其余 scheme（如 `javascript:`、本地盘符路径）validate 会报错。
- 图片语法 `![…](…)` 平台不支持（无图片能力），validate 报错，请用文字描述。
- 想字面显示记号时用反斜杠转义：`\*不是斜体\*`。转义后 validate 不会误报。

### 禁止：块级 Markdown

叙事字段**不支持块级 Markdown**——标题、列表、表格、代码围栏、引用、分隔线
一律用对应结构化块（heading/list/table/code/quote/divider）表达，否则 validate
报错并引导改写：

```text
# 标题            → heading / subheading 块
- 列表 / 1. 列表  → list 块
```代码围栏```     → code 块（Shiki 高亮 + 复制按钮）
| 表格 |          → table 块（支持 caption）
> 引用            → quote 块
---               → divider 块
```

`npm run validate` 会检查：叙事字段是否混入块级记号、链接 scheme 是否在白名单内、
术语引用 key 是否存在于本课程 glossary.ts。

### 课程术语表（glossary.ts，可选但推荐）

整门课共享的概念（**容易遗忘、正文中提前出现、高频反复出现**的术语）收进课程级术语表：

```text
src/content/courses/gorm/
├── course.ts
├── glossary.ts          # ← 术语表（可选）
└── lessons/…
```

```ts
// glossary.ts
import type { GlossaryEntry } from "../../types";

export const glossary: GlossaryEntry[] = [
  {
    key: "auto-migrate",
    term: "AutoMigrate",
    summary: "按传入的 model 结构体自动创建缺失的表/列/索引的迁移入口；适合开发期，不能代替生产迁移。",
    detail: [
      {
        type: "paragraph",
        text: "detail 复用叙事类块（paragraph/list/callout/code/table/quote），支持行内 Markdown 与术语引用。",
      },
    ],
  },
];
```

- 正文引用：`AutoMigrate 可以这样用：[AutoMigrate](glossary:auto-migrate) 的边界是…`
- 词条 key：小写字母/数字/连字符，课程内唯一；`term` 行内显示、`summary` 悬浮卡片
  文案（要能脱离上下文独立读懂）、`detail` 术语页完整讲解（可选）。
- 术语页自动生成在 `/courses/<course-slug>/glossary`，词条按**首次被正文引用的课时**
  排序，未引用词条跟在后面（validate 会警告零引用，提前建档是合法的）。
- validate 检查：key 格式与重复、term/summary 必填、detail 块类型白名单、
  引用 key 是否存在、无 glossary.ts 时禁止出现术语引用。

与块 `definition`（某节课内的术语条）互不依赖；课程术语强调跨课时复用与复习。

## 6. 常用写作模式（不是固定模板）

### 6.1 概念解释

```text
问题 / 场景
→ 概念
→ 为什么需要
→ 工作机制
→ 示例
→ 边界与误区
→ 与下一知识点的连接
```

### 6.2 API / 框架能力

```text
什么时候需要
→ 最小可用示例
→ API / 参数 / 返回语义
→ 常用模式
→ 错误与边界
→ 实际工程提醒
```

### 6.3 工程问题

```text
症状 / 需求
→ 原因
→ 可选方案
→ 推荐方案与原因
→ 实现
→ Trade-off
→ 验证与排错
```

这些模式仅帮助作者组织信息；如果主题不适合，应采用更自然的结构。

## 7. Quiz 与 Exercise

Quiz：

```ts
{
  type: "quiz",
  question: "...",
  options: ["...", "...", "..."],
  answer: 1,
  explanation: "解释为什么该选项正确，以及其他选项为什么不成立。",
}
```

- `answer` 从 0 开始。
- 问题应检验理解，而不是只考页面里刚出现的一句话。

Exercise：

```ts
{
  type: "exercise",
  title: "实现一个事务操作",
  description: "给定 ...，完成 ...，并正确处理回滚。",
  hint: "先考虑哪些错误路径必须触发 rollback。",
}
```

练习应要求学习者做出实际判断或操作；如果没有练习价值，可以不使用。

## 8. 占位课时与课程渐进生产

允许先在 `course.ts` 写完整大纲，再逐步创建 lesson 文件。

这尤其适合：

- 先策划整门课程；
- 多 Agent 分章节并行；
- 课程持续维护；
- 先发布部分章节。

`npm run validate` 会对“大纲存在但没有课时文件”给出警告。该警告可以是正常状态，但 Reviewer 应确认是否符合当前计划。

## 9. 多 Agent 写入建议

平台层面的所有权规则见 `docs/AGENTS.md`。简要约定：

- Planner / Lead 负责 `course.ts` 和 lesson slug 分配。
- Author 只修改被分配的 `lessons/<slug>.ts`。
- Author 发现大纲问题时提出修改建议，不直接与其他 Author 争抢 `course.ts`。
- Reviewer / Integrator 最终检查课程整体一致性并执行验证。

## 10. 平台能力缺口

如果课程确实需要当前平台没有的表达方式，例如专门的架构图、代码 Diff、交互 Playground：

1. 不要在 Lesson 数据里发明未定义字段。
2. 记录需要表达的教学目标和为什么现有 block 不够。
3. 把它作为独立的 **Platform Capability Gap** 交给平台任务处理。
4. 平台扩展完成后，再让课程使用新 block。

## 11. 校验

内容生产后：

```bash
npm run validate
npm run typecheck
```

交付或提交前：

```bash
npm run build
```

常见错误包括：

- 大纲内 slug 重复；
- 跨课程 lesson slug 重复；
- 文件名与 `lesson.slug` 不一致；
- `courseSlug` 错误；
- `quiz.answer` 越界；
- 课时文件存在但没有被大纲收录。

## 12. 上线前内容检查

- [ ] 课程目标与用户要求一致。
- [ ] 已完成课时不是只有标题、简介或宣传文案。
- [ ] 示例、API 与事实准确。
- [ ] 重要错误路径、陷阱、边界在需要时被解释。
- [ ] 章节之间没有明显重复、断层或术语冲突。
- [ ] 占位课时是有意保留，而不是漏写。
- [ ] `learners`、统计、视频与外部资料不存在虚假占位数据。
- [ ] `npm run validate` 无错误。
- [ ] `npm run build` 通过。

## 13. 让 AI 创作课程

如果环境安装了课程创作 Skill，优先让 Skill 负责：

```text
Learning Brief
→ Research
→ Knowledge Model
→ Course Planning
→ Lesson Authoring
→ Review
```

本项目文档只提供平台能力与写入契约。

如果没有专门 Skill，可以使用 `docs/LLM-PROMPT.md` 作为 standalone fallback。
