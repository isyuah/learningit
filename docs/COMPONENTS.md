# COMPONENTS.md — 组件目录与 API

> 模板自带约 40 个组件，全部零第三方 UI 依赖（图标用 lucide-react）。
> 站内 `/components` 页面有每个组件的**实时演示与可复制代码**，本文件是文字版速查。
> 全部组件均支持亮/暗两种模式、键盘焦点（`:focus-visible` 描边）与减少动态偏好。

## 目录

- [基础组件（src/components/ui）](#基础组件)
- [教学组件（src/components/learning）](#教学组件)
- [布局组件（src/components/layout）](#布局组件)
- [组合示例](#组合示例)

---

## 基础组件

### Button / LinkButton — `ui/button.tsx`

```tsx
<Button variant="primary" size="md" loading icon={<Sparkles />}>开始学习</Button>
<LinkButton to="/courses/foo" variant="secondary">浏览大纲</LinkButton>
```

- `variant`: `primary`（主行动）| `secondary`（描边）| `ghost` | `soft` | `danger`
- `size`: `sm` | `md` | `lg`；`loading` 显示 spinner 并禁用；`icon` 前置图标
- `LinkButton` 渲染 react-router `<Link>`，属性与 `Link` 相同

### Badge — `ui/badge.tsx`

```tsx
<Badge tone="primary">入门</Badge>
<Badge tone="success" dot>已完成</Badge>
```

- `tone`: `neutral | primary | amber | success | warning | danger | info`
- `dot`: 前置语义圆点（仅语义状态使用）

### Card — `ui/card.tsx`

```tsx
<Card>
  <CardHeader title="标题" description="副标题" action={<Badge>标签</Badge>} />
  <CardBody>内容</CardBody>
  <CardFooter><Button size="sm">操作</Button></CardFooter>
</Card>
```

### 表单控件 — `ui/field.tsx` + `ui/select.tsx`

```tsx
<Field label="邮箱" hint="用于接收提醒" required error="格式不正确">
  <Input type="email" />
</Field>
<Textarea placeholder="…" />
<Checkbox label="订阅提醒" defaultChecked />
<Radio name="theme" label="白天" />
<Switch label="专注模式" checked={on} onChange={setOn} />
```

**Select（自研下拉，非原生）**：

```tsx
<Select
  value={value}                    // string | null
  onChange={setValue}              // (value: string) => void
  placeholder="请选择…"
  error
  options={[
    { value: "reading", label: "阅读课" },
    { value: "quiz", label: "测验" },
  ]}
/>
```

- 完全自绘（触发器 + Portal 弹层），支持键盘：Enter/空格 打开、↑↓ 移动、
  Enter 选择、Esc 关闭、Home/End 跳转；弹层自动避让视口边缘。
- `Field` 统一提供标签/提示/错误。

### Dialog — `ui/dialog.tsx`

```tsx
<Dialog open={open} onClose={() => setOpen(false)} title="标题" description="副标题" footer={<Button>确定</Button>}>
  内容
</Dialog>
```

支持 ESC、点击遮罩关闭、滚动锁定、焦点还原；移动端抽屉场景同样适用。

### Tabs / Accordion / Tooltip / Breadcrumbs — `ui/tabs.tsx` 等

```tsx
<Tabs tabs={[{ key: "a", label: "讲解", content: <p>…</p> }]} />
<Accordion items={[{ title: "第一章", content: <p>…</p> }]} defaultOpen={[0]} multiple />
<Tooltip content="提示文字" side="top"><Button>悬停</Button></Tooltip>
<Breadcrumbs items={[{ label: "首页", to: "/" }, { label: "当前页" }]} />
```

### 状态类 — `ui/skeleton.tsx`、`ui/progress.tsx`、`ui/empty-state.tsx`

```tsx
<Skeleton className="h-5 w-3/4" />
<Spinner label="加载中" />
<ProgressBar value={62} showLabel />
<ProgressRing value={75} size={44} />
<EmptyState icon={<Info />} title="还没有内容" description="…" action={<Button>去添加</Button>} />
```

### Toast 轻提示 — `ui/toast.tsx`

```tsx
// main.tsx 根部包一层 <ToastProvider>
const { push } = useToast();
push({ tone: "success", title: "已保存", description: "进度已记录" });
```

- `tone`: `success | info | danger`；3.8 秒自动消失；最多同屏 4 条。
- 也可手动渲染 `<Toaster toasts={…} onDismiss={…} />`。

### CommandMenu 命令面板（Ctrl/Cmd+K 站内搜索）— `ui/command-menu.tsx`

```tsx
// 放在页头任意位置即可；全局 Ctrl/Cmd+K 也能唤起
<CommandMenu />
```

- 索引来自 `src/content/courses/`（约定式加载），新增课程/课时后自动可搜。
- 搜索课程、课时与页面；`↑↓` 选择、`Enter` 跳转、`Esc` 关闭；点击遮罩关闭。
- 已接入 `SiteHeader`（页头搜索按钮），移动端同样可用。

### Avatar 首字头像 — `ui/avatar.tsx`

```tsx
<Avatar name="陈老师" size="md" />
```

按姓名取首字 + 确定性主题配色（无图片素材时的讲师/同学占位）。

---

## 教学组件

### 课时内容块（核心） — `learning/lesson-blocks.tsx`

`Lesson.blocks` 中的每种块类型对应一个渲染器（自动生成锚点 id 供目录跳转）。
块类型定义见 `src/content/types.ts`，教学见 `docs/CONTENT-AUTHORING.md`：

| 块类型 | 组件 |
| --- | --- |
| `paragraph` / `heading` / `subheading` / `list` | 内置排版 |
| `callout` | `Callout`（tip/note/warning/example） |
| `code` | `CodeBlock`（深色面板、**Shiki 语法高亮**、语言标签、复制按钮、可选行号） |
| `table` | 内置数据表（含表头/表题） |
| `definition` | `Definition` 术语条 |
| `keypoints` | `KeyPoints` 本课要点 |
| `quiz` | `Quiz` 交互测验（A/B/C/D 选项、即时反馈、讲解、重做） |
| `exercise` | `Exercise` 练习卡（提示可折叠） |
| `video` | `VideoEmbed`（youtube/bilibili/mp4/placeholder） |
| `quote` / `divider` | 内置排版 |

### CodeBlock 语法高亮 — `learning/code-block.tsx` + `lib/highlight.ts`

```tsx
<CodeBlock code="const x = 1" language="ts" title="demo.ts" showLineNumbers />
```

- 高亮引擎：**Shiki**（`shiki/bundle/full`，VS Code 同款语法，离线可用、无 wasm）。
- **懒加载**：首次出现代码块才加载高亮引擎与对应语言语法（独立 chunk，按语言分包，
  `go`≈45KB / `typescript`≈180KB 等），不拖慢首屏；结果按 (语言, 代码) 缓存。
- **覆盖 Go / C++ / Rust / Java / PHP / Ruby 等后端语言，及 ts/tsx/js/jsx/html/css/sql/
  json/bash/python/vue/svelte 等**（bundle/full 几乎所有语言）：
  短名自动映射（`ts`→`typescript`、`js`→`javascript`、`py`→`python`…），
  不支持的代码语言（如 `text`）自动回退为纯文本。
- 复制按钮自带降级（异步 Clipboard API → `execCommand`），仅成功时显示"已复制"。
- 换主题：编辑 `src/lib/highlight.ts` 里的 `THEME` 常量（主题列表见
  `node_modules/@shikijs/themes`）。

### 课程导航类 — `learning/course-card.tsx`、`lesson-list.tsx`、`lesson-nav.tsx`

```tsx
<CourseCard course={course} lessonsCount={n} />
<CourseHero course={course} lessonsCount={n} />
<LessonList course={course} activeSlug="…" completed={completedSet} />
<LessonRow courseSlug="…" meta={meta} active completed />
<LessonNav course={course} currentSlug="…" />   // 自动算上一课/下一课
```

### 目录 — `learning/toc.tsx`

```tsx
<TableOfContents entries={collectToc(lesson.blocks)} />
```

`collectToc` 从课时内容块提取目录项；滚动监听（IntersectionObserver）高亮当前小节。

### Flashcard 记忆卡 — `learning/flashcard.tsx`

```tsx
<Flashcard front="什么是主键？" back="唯一标识一行记录的列" />
```

3D 翻面动画（`motion-reduce` 时关闭），正面提问、背面答案，适合术语复习。

### Feedback 课时反馈 — `learning/feedback.tsx`

```tsx
<Feedback onFeedback={(value) => api.send(value)} />
```

「有帮助 / 一般」两个选项，点选后显示致谢；`value` 为 `"helpful" | "not-helpful"`。

---

## 布局组件

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| `SiteHeader` | `layout/site-header.tsx` | 吸顶毛玻璃、路由高亮、主题切换、移动端抽屉 |
| `SiteFooter` | `layout/site-footer.tsx` | 关于 + 链接列 + 版权（数据来自 `site.ts`） |
| `Logo` | `layout/logo.tsx` | 品牌字「知」+ 站点名 |

---

## 组合示例

**课时页三栏布局**（`pages/lesson.tsx` 的简化）：

```tsx
<div className="grid gap-8 lg:grid-cols-[17rem_1fr] xl:grid-cols-[17rem_1fr_13rem]">
  <aside className="sticky top-20">{/* SidebarCourseCard + LessonList */}</aside>
  <article>
    {/* Breadcrumbs → 课时标题 → LessonBlocks → 标记完成 → LessonNav */}
  </article>
  <aside className="sticky top-20"><TableOfContents entries={toc} /></aside>
</div>
```

**内容块即组件**：新增块类型 = `types.ts` 扩联合类型 + `lesson-blocks.tsx` 加一个 case。
