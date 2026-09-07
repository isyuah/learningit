# DESIGN.md — 设计系统与换肤指南

> 本模板的视觉语言：**现代 · 简约 · 轻巧灵动**，面向开发 / 编程教学站点。
> 全部设计变量集中在 `src/index.css` 的 `@theme` 中——改一个变量，全站生效。

## 1. 设计原则

- **现代而非复古**：不使用终端/黑客、纸张/书本等强风格化主题，而是当前主流产品的
  轻量视觉语言：浅色为主、留白充足、细边框、柔阴影。
- **简约**：元素克制——一个主色（靛紫）、一个强调色（暖琥珀）、一套中性灰；
  不用大面积渐变、发光或纹理。
- **轻巧灵动**：小圆角、轻阴影、细描边；交互上有克制的动效（悬停轻抬、箭头滑动、
  淡入），尊重 `prefers-reduced-motion`。

## 2. 颜色（Color）

| 角色 | 令牌 | 亮色值 | 用途 |
| --- | --- | --- | --- |
| 页面底色 | `--color-canvas` | `#F7F8FA` | 页面背景 |
| 交替底色 | `--color-canvas-2` | `#EEF0F5` | 交替区块、悬停底 |
| 卡片表面 | `--color-surface` | `#FFFFFF` | 卡片 / 面板 |
| 主文字 | `--color-ink` | `#191B21` | 标题、正文 |
| 次级文字 | `--color-ink-soft` | `#525864` | 说明文字 |
| 弱化文字 | `--color-ink-faint` | `#7C8391` | 仅用于大号 / 装饰 |
| 描边 | `--color-line` | `#E5E7EC` | 分隔线、边框 |

**主色（靛紫）**：`primary-50 ~ 900`，`600 = #5041D2` 为主按钮色（白字对比度 ≈ 8:1）。

**强调色（暖琥珀）**：`amber-100 ~ 600`，用于「本课要点」、引言、术语条等**高亮**场景，
扮演「高亮笔」的角色——只在小面积出现。

**语义色**：`success / danger / warning / info` 各配一个 `*-soft` 浅底，用于徽章、提示框、
测验反馈。语义状态永远配合文字使用，不只靠颜色传达。

**暗色模式**：`night-*` 系列（`--color-night` = `#0F1116`），中性石板色，柔和不刺眼。
切换机制：`<html>` 上的 `.dark` 类（`src/lib/theme.ts` + `index.html` 内联脚本防闪烁）。
写样式时统一用 `dark:` 前缀 + `night-*` 令牌，不要写死暗色 hex。

## 3. 字体（Typography）

| 角色 | 字体 | 说明 |
| --- | --- | --- |
| 标题（西文） | **Manrope Variable** | 现代几何无衬线，圆润轻盈 |
| 中文 | **Noto Sans SC Variable**（思源黑体） | 与 Manrope 气质协调 |
| 正文 | 同中文（`--font-sans`） | 行高 1.7，长文舒适 |
| 代码 | **JetBrains Mono Variable** | 代码块、数值、文件名 |

- 标题用 `font-display` 工具类（西文自动落 Manrope，中文落思源黑体）。
- 全部字体通过 npm 包自托管（`@fontsource-variable/*`），无外部 CDN，离线可用；
  中文按 unicode-range 子集按需加载。
- 需要换字体：改 `@theme` 里的 `--font-display` / `--font-sans` / `--font-mono`，
  并在 `src/main.tsx` 里 import 对应的 fontsource 包。

## 4. 圆角与阴影

- 圆角：`xs .25rem → 2xl 1.25rem`，默认卡片用 `rounded-lg`（.75rem），按钮 `rounded-md`。
- 阴影：三档——`shadow-card`（卡片默认）、`shadow-lift`（悬停/漂浮）、`shadow-pop`（对话框）。
  阴影都很轻，靠描边而非阴影表达层次。

## 5. 组件约定

- **按钮**：主行动一个（`primary`），其余用 `secondary` / `ghost` / `soft`；危险操作用 `danger`。
- **徽章**：元信息（难度、类型、状态），语义状态带 `dot` 圆点。
- **卡片**：`Card + CardHeader + CardBody + CardFooter`，用于分组信息而非装饰。
- **教学组件**（Callout / KeyPoints / Quiz / Exercise / Definition）是模板的核心，
  都从课时内容块（`LessonBlock`）驱动，见 `docs/CONTENT-AUTHORING.md`。
- **动效**：`animate-rise-in`（页面进入）、`animate-fade-in`（遮罩）、
  `animate-scale-in`（对话框）；交互反馈用 150ms 过渡。不要在滚动时对每个区块做进场动画。

## 6. 换肤步骤（换个品牌色）

1. 改 `@theme` 中的 `--color-primary-*`（建议 50–900 一起换，保持梯度）。
2. 检查对比度：主按钮（白字）主色建议 ≥ 4.5:1，正文 ≥ 7:1。
3. 改 `--color-amber-*` 与 `--color-semantic-*` 以匹配新品牌。
4. 换字体：改 `--font-*` + `main.tsx` 的 import。
5. 暗色模式无需额外工作——所有组件都已用令牌 + `dark:` 变体。

## 7. 视觉审计清单

- [ ] 明暗两种模式下对比度都达标（正文 ≥ 7:1，装饰文字 ≥ 4.5:1）
- [ ] 颜色不作为唯一的信息载体（语义状态有文字）
- [ ] 键盘可操作（`:focus-visible` 描边全局生效）
- [ ] 减少动态偏好生效（`prefers-reduced-motion`）
- [ ] 390px 与 1440px 两档宽度无横向溢出
