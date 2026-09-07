# PLATFORM-CONTRACT.md — 课程平台硬约束

> 本文件描述当前 Learning Platform **实际必须满足的内容契约与运行约束**。
> 它回答“数据怎样才能被平台正确发现、加载、路由、校验和渲染”，而不规定课程应该如何教学。
>
> 教学策划、知识组织、学习对象分析、章节写作策略由课程创作 Skill 或内容作者负责；
> 本文件只保存平台级事实与硬约束。

## 1. 权威来源与优先级

当文档与代码发生冲突时，以实际类型和校验器为准：

1. `src/content/types.ts`：内容数据结构的权威契约。
2. `scripts/validate.ts`：平台当前会主动检查的内容约束。
3. `src/content/courses/index.ts`：课程与课时的发现、聚合和查询方式。
4. 本文件：对上述实现的稳定说明。
5. `docs/CONTENT-AUTHORING.md`：人工/LLM 写内容时的操作指南。
6. `docs/LLM-PROMPT.md`：未安装课程创作 Skill 时的备用提示词，不是平台契约。

用户的明确要求可以改变课程内容与写作方式，但不能绕过会导致平台无法正确运行的数据约束。

## 2. 内容目录约定

每门课程独占一个目录：

```text
src/content/courses/<course-slug>/
├── course.ts
└── lessons/
    ├── <lesson-slug>.ts
    └── ...
```

- `course.ts` 必须导出 `course: Course`。
- `lessons/*.ts` 每个文件必须导出 `lesson: Lesson`。
- 新课程和新课时由 `import.meta.glob` 自动发现，不需要修改 `src/content/courses/index.ts`。
- 推荐用 `npm run scaffold:course -- --slug <slug> --title "..."` 创建课程骨架。

## 3. Course 约束

- 课程目录名应与 `course.slug` 一致；当前校验器不一致时给出警告。
- `course.chapters` 决定课程大纲、章节顺序和课时顺序。
- `Chapter.id` 应在课程内唯一。
- 同一课程的大纲中不得重复 `LessonMeta.slug`。
- 大纲可以先声明尚未完成的课时；没有对应课时文件时，平台会显示占位空状态。

## 4. Lesson 约束

### 4.0 课时元信息权威：大纲 LessonMeta

课时展示用的元信息 **slug / title / minutes / kind** 一律以 `course.ts` 大纲中的
`LessonMeta` 为唯一权威来源。页面（课时页、侧边栏、搜索、AI 助手）只读大纲，
不读课时文件里同名字段。

课时文件里的 `slug / courseSlug / title / minutes / kind` 仅是**向后兼容的可选
冗余声明**：可以省略；声明了就必须与大纲一致，`npm run validate` 会把不一致判为
错误。建议新内容省略它们。

课时独有字段：

- `summary`：一句话简介（课时页页头、侧边栏），只有课时文件能提供。
- `blocks`：课时正文内容块序列。

### 4.1 课时文件约束

对于 `src/content/courses/<course-slug>/lessons/<lesson-slug>.ts`：

- **文件名即课时真实 slug**（权威键）；冗余的 `lesson.slug` 若声明，必须等于文件名。
- 冗余的 `lesson.courseSlug` 若声明，必须等于所属课程的 `course.slug`。
- 课时若要进入课程正常学习路径，文件名 slug 必须出现在 `course.ts` 大纲中；
  大纲中没有的课时文件视为「未收录」（校验警告），页面不会展示。
- 大纲声明了、但没有对应课时文件的课时显示为占位空状态（可有意为之）。

### 4.2 当前版本的全局唯一 slug 约束

当前 `src/content/courses/index.ts` 将全部课时文件聚合为：

```ts
Record<string, Lesson> // key = 文件名 slug（lesson 文件的真实 slug）
```

因此 **课时文件 slug 当前必须跨课程全局唯一**。`npm run validate` 会把跨课程
重复 slug 判为错误。

建议新课时使用带课程语境的 slug，例如：

```text
gorm-query-basics
gorm-transactions
redis-data-types
redis-persistence
```

而不是在多门课程中反复使用：

```text
introduction
installation
basics
```

如果未来平台改成按 `(courseSlug, lessonSlug)` 二级查询，应同步修改本条约束和校验器。

## 5. LessonBlock 契约

`Lesson.blocks` 的所有合法类型和字段只以 `src/content/types.ts` 为准。

当前平台支持的内容块包括正文、标题、列表、提示、代码、表格、术语、要点、测验、练习、视频、引用和分隔线等。具体 API 与展示效果见：

- `src/content/types.ts`
- `docs/COMPONENTS.md`
- `docs/CONTENT-AUTHORING.md`

不要为了课程需要而在数据中发明未定义的 block 字段或 block 类型。

如果现有 block 无法清晰表达某类学习内容，应把它记录为 **Platform Capability Gap**。只有在任务明确包含平台扩展时，才修改平台类型和渲染器。

## 6. Quiz 约束

- `answer` 是正确选项的 **0-based 下标**。
- `answer` 必须落在 `options` 范围内。
- `options` 至少应有两个选项；当前校验器不足两个时给出警告。
- `explanation` 属于 `Quiz` 数据契约的一部分，应解释正确答案的依据，而不只是重复答案。

## 7. 校验与构建

任何修改 `src/content/` 的任务完成后至少运行：

```bash
npm run validate
npm run typecheck
```

准备交付或提交前运行：

```bash
npm run build
```

其中：

- `validate` 检查课程/课时内容约束；
- `typecheck` 检查 TypeScript 类型；
- `build` 包含类型检查并生成生产构建。

警告不一定代表错误，例如大纲中存在尚未写内容的占位课时可能是有意行为；但作者或 Reviewer 应确认它确实符合当前任务状态。

## 8. 平台代码与课程内容的边界

普通课程生产任务默认只修改：

```text
src/content/courses/<target-course>/**
```

必要时才修改：

```text
src/content/site.ts
```

以下属于平台层，普通课程作者不应为了单门课程顺手修改：

```text
src/content/types.ts
src/content/courses/index.ts
src/components/**
src/pages/**
src/index.css
src/App.tsx
scripts/**
```

若确实需要新增内容表达能力，应把它作为独立的平台扩展任务处理，并同时更新类型、渲染器、文档与校验逻辑（如适用）。
