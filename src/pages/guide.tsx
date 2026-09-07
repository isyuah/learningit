import { Link } from "react-router-dom";
import { ArrowRight, BookOpenText, Bot, Compass, Feather, FileCode2, Layers, Palette, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/learning/callout";
import { CodeBlock } from "@/components/learning/code-block";
import { KeyPoints } from "@/components/learning/key-points";

/* ------------------------------------------------------------------ */

function Step({
  index,
  title,
  description,
  children,
}: {
  index: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="grid gap-5 border-t border-line py-10 first:border-t-0 dark:border-night-line lg:grid-cols-[8rem_1fr]">
      <div>
        <span className="font-display text-4xl font-semibold text-primary-300 dark:text-primary-800">
          {index}
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-ink dark:text-night-ink">{title}</h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-ink-soft dark:text-night-soft">
          {description}
        </p>
        {children && <div className="mt-6 space-y-6">{children}</div>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function GuidePage() {
  return (
    <div className="wrap pb-20 pt-10">
      <header className="max-w-2xl">
        <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-300">
          <Compass aria-hidden className="size-3.5" /> 使用指南
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-snug text-ink sm:text-4xl dark:text-night-ink">
          把模板变成你的教学网站
        </h1>
        <p className="mt-4 leading-relaxed text-ink-soft dark:text-night-soft">
          核心思路：<strong className="text-ink dark:text-night-ink">内容即数据</strong>。
          页面、组件与路由都已就绪，你要做的只是往 <code className="rounded bg-canvas-2 px-1.5 py-0.5 font-mono text-[0.8125rem] dark:bg-night-surface-2">src/content/</code>{" "}
          里填数据。完整的 LLM 协作版本文档在 <code className="font-mono text-[0.8125rem]">docs/</code> 目录。
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            { icon: Feather, label: "零后端，静态可部署" },
            { icon: Layers, label: "结构化的内容模型" },
            { icon: Bot, label: "LLM 友好文档" },
            { icon: Palette, label: "设计令牌可换肤" },
          ].map((t) => (
            <Badge key={t.label} tone="neutral">
              <t.icon aria-hidden className="mr-1 size-3" />
              {t.label}
            </Badge>
          ))}
        </div>
      </header>

      <div className="mt-12">
        {/* ---------------- 01 ---------------- */}
        <Step
          index="01"
          title="安装并运行"
          description="复制仓库后安装依赖，本地开发即可预览完整站点。"
        >
          <CodeBlock
            language="bash"
            title="快速开始"
            code={`npm install
npm run dev     # 打开 http://localhost:5173

npm run build   # 产出静态站点到 dist/
npm run preview # 本地预览构建产物`}
          />
          <Callout variant="note">
            需要 Node.js ≥ 20.19。用 pnpm / yarn 亦可，命令对应替换。
          </Callout>
        </Step>

        {/* ---------------- 02 ---------------- */}
        <Step
          index="02"
          title="配置站点门面"
          description="编辑 src/content/site.ts：站点名、导航、页脚与首页 hero 文案都在这里。全部有注释，直接替换示例文本。"
        >
          <CodeBlock
            language="ts"
            title="src/content/site.ts（节选）"
            code={`export const site = {
  name: "知学",                 // ← 改成你的站点名
  nav: [
    { label: "首页", to: "/" },
    { label: "课程", to: "/#courses" },
  ],
  hero: {
    kicker: "在线课程模板",
    title: ["系统化地学习", "一门真正学得会的课"],
    primaryCta: { label: "浏览课程", to: "/#courses" },
    stats: [],                  // ← 不需要数据条就留空数组
  },
};`}
          />
        </Step>

        {/* ---------------- 03 ---------------- */}
        <Step
          index="03"
          title="新建课程（脚手架或手写）"
          description={
            '推荐用脚手架命令：npm run scaffold:course -- --slug my-course --title "我的课程"。它会自动建好文件夹与示例文件。手写则在 src/content/courses/<slug>/course.ts 按 Course 类型填写，文件放进目录即自动生效。'
          }
        >
          <CodeBlock
            language="ts"
            title="src/content/courses/<slug>/course.ts（节选）"
            code={`import type { Course } from "../../types";

export const course: Course = {
  slug: "frontend-basics",        // 路由用：/courses/frontend-basics
  title: "前端入门：从 HTML 到 React",
  tagline: "零基础也能写出第一个网页应用",
  level: "beginner",              // beginner | intermediate | advanced
  hours: 12,
  coverIndex: "01",
  coverColor: "primary",          // primary | amber | info | success | danger
  chapters: [
    {
      id: "ch1",
      title: "认识 Web 与浏览器",
      lessons: [
        { slug: "web-how-it-works", title: "Web 是怎么工作的", minutes: 12, kind: "reading" },
        // kind: reading | video | exercise | quiz
      ],
    },
  ],
}`}
          />
        </Step>

        {/* ---------------- 04 ---------------- */}
        <Step
          index="04"
          title="写一节课（内容块）"
          description="在 src/content/courses/<slug>/lessons/ 下新建文件，一节课一个文件，导出 lesson。每节课由内容块数组组成——这是模板最核心的写作方式。"
        >
          <CodeBlock
            language="ts"
            title="src/content/courses/<slug>/lessons/web-how-it-works.ts（节选）"
            code={`import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "web-how-it-works",
  courseSlug: "frontend-basics",     // 与课程 slug 对应
  title: "Web 是怎么工作的",
  summary: "从输入网址到页面出现，中间发生了什么。",
  minutes: 12,
  kind: "reading",
  blocks: [
    { type: "paragraph", text: "……" },
    { type: "heading", text: "一条请求的旅程" },
    { type: "list", items: ["浏览器发起请求", "服务器返回响应"] },
    { type: "callout", variant: "tip", title: "小贴士", body: "……" },
    { type: "code", language: "html", code: "<h1>你好</h1>" },
    { type: "table", headers: ["角色", "职责"], rows: [["客户端", "渲染"]] },
    { type: "quiz", question: "……", options: ["A", "B"], answer: 0, explanation: "……" },
    { type: "exercise", title: "动手改一改", description: "……" },
    { type: "keypoints", items: ["要点一", "要点二"] },
  ],
};`}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <KeyPoints
              items={[
                "大纲加一条 LessonMeta，课时页就会出现在课程里",
                "忘了写内容文件也没关系——页面会渲染引导性的空状态",
                "文件放进 lessons/ 目录即自动生效，无需改索引",
                "写完运行 npm run validate 自动校验",
              ]}
            />
            <Callout variant="warning" title="注意">
              <code className="font-mono text-[0.8125rem]">lesson.slug</code> 必须与大纲中{" "}
              <code className="font-mono text-[0.8125rem]">LessonMeta.slug</code> 一致，页面才能找到内容。
            </Callout>
          </div>
        </Step>

        {/* ---------------- 05 ---------------- */}
        <Step
          index="05"
          title="换肤与字体"
          description="视觉变量集中在 src/index.css 的 @theme 中：改主色、字体、圆角、阴影即全局生效。暗色模式已内置（页头太阳/月亮按钮切换）。"
        >
          <CodeBlock
            language="css"
            title="src/index.css（节选）"
            code={`@theme {
  /* 把靛紫换成你的品牌色 */
  --color-primary-600: #5041d2;
  --color-primary-700: #4436b0;

  /* 字体：西文 Manrope + 中文思源黑体 */
  --font-display: "Manrope Variable", "Noto Sans SC Variable", sans-serif;
  --font-sans: "Noto Sans SC Variable", "PingFang SC", system-ui, sans-serif;
}`}
          />
          <Callout variant="tip" title="离线字体">
            字体通过 npm 包自托管（@fontsource），无外部 CDN，构建后离线可用。中文字体体积较大，浏览器只按需加载用到的子集。
          </Callout>
        </Step>

        {/* ---------------- 06 ---------------- */}
        <Step
          index="06"
          title="用 LLM 帮你填充内容"
          description="如果当前环境安装了课程创作 Skill，优先让 Skill 负责课程策划、研究、写作和审校；如果没有，可使用 docs/LLM-PROMPT.md 的 standalone fallback。无论哪种方式，课程文件都写入 src/content/courses/<slug>/，最后运行 npm run validate 校验。"
        >
          <CodeBlock
            language="text"
            title="docs/LLM-PROMPT.md（fallback）"
            code={`你是一位在线课程内容编辑。请把下面的大纲转成
模板所需的数据格式，严格遵循 types.ts 中的 LessonBlock
类型，用中文撰写，每节课 8–15 个内容块，覆盖
paragraph / heading / callout / code / keypoints /
quiz / exercise 等类型……

【课程大纲】
……`}
          />
        </Step>

        {/* ---------------- 07 ---------------- */}
        <Step
          index="07"
          title="部署上线"
          description="构建产物是纯静态文件，可部署到任意静态托管（GitHub Pages、Vercel、Netlify、对象存储等）。使用 BrowserRouter 时，需把未匹配路径回写到 index.html。"
        >
          <CodeBlock
            language="text"
            title="部署要点"
            code={`# Vercel / Netlify：Build 命令 npm run build，输出目录 dist/
# 需要 SPA 回退：所有路径重写为 /index.html
# 也可改用 HashRouter（src/main.tsx 中替换 BrowserRouter）零配置部署`}
          />
          <Link
            to="/components"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 transition-colors hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-200"
          >
            下一步：浏览组件库，看看有哪些可用的积木 <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Step>
      </div>

      {/* 文档索引 */}
      <section className="mt-6 border-t border-line pt-10 dark:border-night-line">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink dark:text-night-ink">
          <FileCode2 aria-hidden className="size-5 text-primary-600 dark:text-primary-400" />
          文档目录（docs/）
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/guide", icon: BookOpenText, title: "使用指南（本页）", desc: "七步上手：从安装到部署" },
            { href: "docs/CONTENT-AUTHORING.md", icon: Layers, title: "CONTENT-AUTHORING.md", desc: "内容模型详解与写作规范" },
            { href: "docs/COMPONENTS.md", icon: Feather, title: "COMPONENTS.md", desc: "全部组件 API 与用法" },
            { href: "docs/DESIGN.md", icon: Palette, title: "DESIGN.md", desc: "设计令牌与换肤指南" },
            { href: "docs/AGENTS.md", icon: Bot, title: "AGENTS.md", desc: "AI 仓库操作与多 Agent 所有权约定" },
            { href: "docs/LLM-PROMPT.md", icon: Rocket, title: "LLM-PROMPT.md", desc: "无课程创作 Skill 时的备用提示词" },
          ].map((doc) => (
            <a
              key={doc.title}
              href={doc.href}
              className={cn(
                "group flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 transition-all",
                "hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card",
                "dark:border-night-line dark:bg-night-surface dark:hover:border-primary-700",
              )}
            >
              <doc.icon aria-hidden className="size-5 text-primary-600 dark:text-primary-400" />
              <span className="text-sm font-semibold text-ink group-hover:text-primary-800 dark:text-night-ink dark:group-hover:text-primary-200">
                {doc.title}
              </span>
              <span className="text-xs leading-relaxed text-ink-faint dark:text-night-faint">
                {doc.desc}
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
