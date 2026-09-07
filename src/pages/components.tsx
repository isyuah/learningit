import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  Info,
  LoaderCircle,
  Palette as PaletteIcon,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import {
  Checkbox,
  Field,
  Input,
  Radio,
  Select,
  Switch,
  Textarea,
} from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { Accordion } from "@/components/ui/accordion";
import { Tooltip } from "@/components/ui/tooltip";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Skeleton, Spinner } from "@/components/ui/skeleton";
import { ProgressBar, ProgressRing } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Callout } from "@/components/learning/callout";
import { CodeBlock } from "@/components/learning/code-block";
import { Definition } from "@/components/learning/definition";
import { Exercise } from "@/components/learning/exercise";
import { Feedback } from "@/components/learning/feedback";
import { Flashcard } from "@/components/learning/flashcard";
import { KeyPoints } from "@/components/learning/key-points";
import { Quiz } from "@/components/learning/quiz";
import { VideoEmbed } from "@/components/learning/video-embed";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";

/* ------------------------------------------------------------------ */

function Section({
  id,
  kicker,
  title,
  description,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line py-12 first:border-t-0 dark:border-night-line">
      <p className="text-xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-300">
        {kicker}
      </p>
      <h2 className="mt-1.5 font-display text-2xl font-semibold text-ink dark:text-night-ink">
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft dark:text-night-soft">
          {description}
        </p>
      )}
      <div className="mt-8">{children}</div>
    </section>
  );
}

/** 演示单元：标题 + 示例区 + 代码 */
function Demo({
  title,
  code,
  children,
  className,
}: {
  title: string;
  code?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface dark:border-night-line dark:bg-night-surface">
      <div className={cn("px-5 py-6", className)}>{children}</div>
      {code && (
        <div className="border-t border-line dark:border-night-line">
          <CodeBlock code={code} language="tsx" title={`${title}.tsx`} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const SWATCHES: { name: string; var: string; text?: string }[] = [
  { name: "canvas", var: "var(--color-canvas)", text: "页面底色" },
  { name: "surface", var: "var(--color-surface)", text: "卡片表面" },
  { name: "ink", var: "var(--color-ink)", text: "主文字" },
  { name: "ink-soft", var: "var(--color-ink-soft)", text: "次级文字" },
  { name: "line", var: "var(--color-line)", text: "描边" },
  { name: "primary-700", var: "var(--color-primary-700)", text: "主按钮" },
  { name: "primary-500", var: "var(--color-primary-500)" },
  { name: "primary-200", var: "var(--color-primary-200)" },
  { name: "amber-400", var: "var(--color-amber-400)", text: "强调" },
  { name: "success", var: "var(--color-success)" },
  { name: "warning", var: "var(--color-warning)" },
  { name: "danger", var: "var(--color-danger)" },
];

export function ComponentsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(false);
  const [courseType, setCourseType] = useState<string | null>(null);
  const { push } = useToast();

  return (
    <div className="wrap pb-20 pt-10">
      <header className="max-w-2xl">
        <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-300">
          <PaletteIcon aria-hidden className="size-3.5" /> 设计系统
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-snug text-ink sm:text-4xl dark:text-night-ink">
          组件库与设计令牌
        </h1>
        <p className="mt-4 leading-relaxed text-ink-soft dark:text-night-soft">
          这里演示模板自带的所有组件与令牌。它们覆盖了教学站点的大部分场景；展示页本身就是组件的活文档，
          每个演示下方都有可直接复制的用法代码。
        </p>
      </header>

      {/* ==================== 设计令牌 ==================== */}
      <Section
        id="tokens"
        kicker="Tokens"
        title="颜色 · 字体 · 圆角 · 阴影"
        description="全部视觉变量定义在 src/index.css 的 @theme 中。改一个变量，全站生效。"
      >
        <Demo
          title="颜色"
          code={`// 用法示例：背景、文字、边框
<div className="bg-canvas text-ink">
  <button className="bg-primary-700">主色按钮</button>
  <span className="text-amber-600">强调文字</span>
</div>`}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {SWATCHES.map((s) => (
              <div key={s.name} className="flex flex-col gap-1.5">
                <div
                  className="h-14 rounded-md border border-line-strong/60 dark:border-night-line-strong"
                  style={{ backgroundColor: s.var }}
                />
                <p className="font-mono text-[0.6875rem] text-ink-soft dark:text-night-soft">
                  {s.name}
                </p>
                {s.text && (
                  <p className="text-xs text-ink-faint dark:text-night-faint">{s.text}</p>
                )}
              </div>
            ))}
          </div>
        </Demo>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Demo
            title="字体"
            code={`<h1 className="font-display text-3xl">标题</h1>
<p className="font-sans">正文</p>
<code className="font-mono">const x = 1</code>`}
          >
            <div className="space-y-4">
              <p className="font-display text-2xl font-semibold">
                Manrope · 系统化学习
              </p>
              <p className="text-sm">
                思源黑体 Noto Sans SC：正文阅读、中文界面
              </p>
              <p className="font-mono text-sm">JetBrains Mono：代码与数值</p>
            </div>
          </Demo>

          <Demo title="圆角">
            <div className="flex flex-wrap items-end gap-6">
              {[
                { label: "rounded-md", cls: "rounded-md" },
                { label: "rounded-lg", cls: "rounded-lg" },
                { label: "rounded-xl", cls: "rounded-xl" },
              ].map((r) => (
                <div key={r.cls} className="flex flex-col items-center gap-2">
                  <div className={cn("size-16 border border-line-strong bg-primary-100 dark:border-night-line-strong dark:bg-primary-900/40", r.cls)} />
                  <span className="font-mono text-[0.6875rem] text-ink-faint dark:text-night-faint">
                    {r.label}
                  </span>
                </div>
              ))}
            </div>
          </Demo>

          <Demo title="阴影">
            <div className="flex flex-wrap items-end gap-6">
              {[
                { label: "shadow-card", cls: "shadow-card" },
                { label: "shadow-lift", cls: "shadow-lift" },
                { label: "shadow-pop", cls: "shadow-pop" },
              ].map((s) => (
                <div key={s.cls} className="flex flex-col items-center gap-2">
                  <div className={cn("size-16 rounded-lg border border-line dark:border-night-line", s.cls)} />
                  <span className="font-mono text-[0.6875rem] text-ink-faint dark:text-night-faint">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </Demo>
        </div>
      </Section>

      {/* ==================== 按钮 ==================== */}
      <Section
        id="buttons"
        kicker="Actions"
        title="按钮"
        description="五种变体、三种尺寸；支持图标与加载态。主行动只用一个，其余用次级/幽灵按钮。"
      >
        <Demo
          title="按钮"
          code={`<Button variant="primary">开始学习</Button>
<Button variant="secondary">浏览大纲</Button>
<Button variant="ghost">跳过</Button>
<Button variant="soft">已加入</Button>
<Button variant="danger" size="sm">删除</Button>
<Button loading>提交中</Button>`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button>开始学习</Button>
            <Button variant="secondary">浏览大纲</Button>
            <Button variant="ghost">跳过</Button>
            <Button variant="soft">已加入</Button>
            <Button variant="danger" size="sm">删除</Button>
            <Button loading>提交中</Button>
            <Button disabled>不可用</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-dashed border-line pt-4 dark:border-night-line">
            <Button size="sm">小尺寸</Button>
            <Button size="md">中尺寸</Button>
            <Button size="lg" icon={<Sparkles aria-hidden className="size-4.5" />}>
              大尺寸带图标
            </Button>
            <LinkButton to="/guide" variant="secondary" icon={<ArrowRight aria-hidden className="size-4" />}>
              链接按钮（LinkButton）
            </LinkButton>
          </div>
        </Demo>
      </Section>

      {/* ==================== 徽章 ==================== */}
      <Section
        id="badges"
        kicker="Meta"
        title="徽章与标签"
        description="用于课程难度、课时类型、状态等元信息。语义状态（成功/警告/危险）建议配合文字使用。"
      >
        <Demo
          title="徽章"
          code={`<Badge tone="primary">入门</Badge>
<Badge tone="amber">测验</Badge>
<Badge tone="success" dot>已完成</Badge>`}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge>默认</Badge>
            <Badge tone="primary">入门</Badge>
            <Badge tone="amber">测验</Badge>
            <Badge tone="info">视频</Badge>
            <Badge tone="success" dot>已完成</Badge>
            <Badge tone="warning" dot>即将截止</Badge>
            <Badge tone="danger">已过期</Badge>
          </div>
        </Demo>
      </Section>

      {/* ==================== 卡片 ==================== */}
      <Section
        id="cards"
        kicker="Surfaces"
        title="卡片"
        description="纸面 + 细边框的轻量容器。用于分组相关信息，而不是装饰。"
      >
        <Demo
          title="卡片"
          code={`<Card>
  <CardHeader title="课程信息" description="副标题说明" action={<Badge>入门</Badge>} />
  <CardBody>…内容…</CardBody>
  <CardFooter>…操作区…</CardFooter>
</Card>`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="课程信息" description="卡片由三部分组成" action={<Badge tone="primary">入门</Badge>} />
              <CardBody>
                <p className="text-sm leading-relaxed text-ink-soft dark:text-night-soft">
                  CardHeader 承载标题与元信息，CardBody 放正文，
                  CardFooter 放操作。
                </p>
              </CardBody>
              <CardFooter>
                <Button size="sm">主操作</Button>
                <Button size="sm" variant="ghost">
                  次要操作
                </Button>
              </CardFooter>
            </Card>

            <Card className="flex flex-col items-center justify-center p-6 text-center">
              <p className="text-sm font-medium text-ink dark:text-night-ink">纯内容卡片</p>
              <p className="mt-1 text-xs text-ink-faint dark:text-night-faint">
                没有标题区/页脚时，直接用 <code className="font-mono text-[0.6875rem]">Card</code> 包内容即可
              </p>
            </Card>
          </div>
        </Demo>
      </Section>

      {/* ==================== 表单 ==================== */}
      <Section
        id="forms"
        kicker="Inputs"
        title="表单控件"
        description="Field 统一标签、提示与错误状态；控件均可直接受控使用。"
      >
        <Demo
          title="表单"
          code={`<Field label="邮箱" hint="用于接收学习提醒" required>
  <Input type="email" placeholder="you@example.com" />
</Field>
<Field label="课程类型" error="请选择一个类型">
  <Select
    value={type}
    onChange={setType}
    options={[
      { value: "reading", label: "阅读课" },
      { value: "exercise", label: "练习课" },
      { value: "quiz", label: "测验" },
    ]}
  />
</Field>
<Checkbox label="订阅每周课程提醒" />
<Switch label="开启专注模式" checked={on} onChange={setOn} />`}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-4">
              <Field label="邮箱" hint="用于接收学习提醒" required>
                <Input type="email" placeholder="you@example.com" />
              </Field>
              <Field label="课程类型" error="请选择一个类型">
                <Select
                  value={courseType}
                  onChange={setCourseType}
                  placeholder="请选择…"
                  options={[
                    { value: "reading", label: "阅读课" },
                    { value: "exercise", label: "练习课" },
                    { value: "quiz", label: "测验" },
                  ]}
                />
              </Field>
              <Field label="备注">
                <Textarea placeholder="写点想说的…" />
              </Field>
            </div>
            <div className="space-y-3.5 rounded-md border border-dashed border-line-strong p-4 dark:border-night-line-strong">
              <Checkbox label="订阅每周课程提醒" defaultChecked />
              <Checkbox label="接收学习报告" />
              <Radio name="radio-demo" label="白天模式" defaultChecked />
              <Radio name="radio-demo" label="夜间模式" />
              <Switch label="开启专注模式" checked={switchOn} onChange={setSwitchOn} />
            </div>
          </div>
        </Demo>
      </Section>

      {/* ==================== 教学反馈 ==================== */}
      <Section
        id="teaching"
        kicker="Teaching"
        title="教学组件"
        description="这是模板的核心：讲解、代码、要点、练习、测验与视频，全部可组合进课时内容块。"
      >
        <div className="space-y-6">
          <Demo
            title="提示框"
            code={`<Callout variant="tip" title="小贴士">…</Callout>
<Callout variant="note">补充说明…</Callout>
<Callout variant="warning" title="注意">…</Callout>
<Callout variant="example" title="举例">…</Callout>`}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Callout variant="tip" title="小贴士">
                用 F12 开发者工具实时改样式，比死记属性快。
              </Callout>
              <Callout variant="note">补充说明：进度保存在本地浏览器中。</Callout>
              <Callout variant="warning" title="注意">
                不要用 <code className="font-mono text-[0.8125rem]">&lt;div&gt;</code> 装下所有内容。
              </Callout>
              <Callout variant="example" title="举例">
                一个 URL 由协议、域名与路径组成。
              </Callout>
            </div>
          </Demo>

          <div className="grid gap-6 lg:grid-cols-2">
            <Demo
              title="要点与术语"
              code={`<KeyPoints items={["要点一", "要点二"]} />
<Definition term="HTTP" definition="通信协议" />`}
            >
              <div className="space-y-4">
                <KeyPoints items={["要点先行，先声明学习目标", "代码可直接复制运行", "测验即时反馈并附讲解"]} />
                <Definition term="HTTP" definition="超文本传输协议，浏览器与服务器之间的通信语言。" />
              </div>
            </Demo>

            <Demo
              title="练习与测验"
              code={`<Exercise title="动手改一改" description="…" hint="提示…" />
<Quiz question="…" options={["A","B"]} answer={0} explanation="…" />`}
            >
              <div className="space-y-4">
                <Exercise
                  title="动手改一改"
                  description="把示例页面改成你自己的介绍页，加一个链接。"
                  hint={"链接用 <a href=\"…\">文字</a> 的写法。"}
                />
                <Quiz
                  question="下面哪个选择器的优先级最高？"
                  options={["p", ".card", "#header"]}
                  answer={2}
                  explanation="ID 选择器优先级最高，class 次之，标签最低。"
                />
              </div>
            </Demo>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Demo
              title="代码块"
              code={`<CodeBlock code="…" language="tsx" title="demo.tsx" showLineNumbers />`}
            >
              <CodeBlock
                language="tsx"
                title="lesson.tsx"
                code={`function Lesson({ blocks }) {
  return blocks.map(renderBlock);
}`}
                showLineNumbers
              />
            </Demo>

            <Demo title="视频占位">
              <VideoEmbed
                title="跟着视频一起写：5 分钟完成第一个页面"
                provider="placeholder"
                src=""
                duration="05:12"
              />
            </Demo>
          </div>
        </div>
      </Section>

      {/* ==================== 状态 ==================== */}
      <Section
        id="states"
        kicker="States"
        title="加载、进度与空状态"
        description="骨架屏保持布局稳定；空状态说明原因与下一步；进度组件贯穿课程体系。"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <Demo title="骨架屏与加载">
            <div className="space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Spinner className="pt-2" />
            </div>
          </Demo>

          <Demo title="进度">
            <div className="flex flex-col gap-5">
              <ProgressBar value={62} showLabel label="示例" />
              <ProgressBar value={100} label="完成" />
              <ProgressRing value={75} />
            </div>
          </Demo>

          <Demo
            title="空状态"
            code={`<EmptyState title="还没有课程" description="…" action={<Button>去添加</Button>} />`}
          >
            <EmptyState
              icon={<Info aria-hidden className="size-6" />}
              title="这是一节示例占位课时"
              description="大纲里有这节课，但对应课程的 lessons/ 目录还没有它的内容文件。"
              action={<Button size="sm">查看文档</Button>}
            />
          </Demo>
        </div>
      </Section>

      {/* ==================== 导航与交互 ==================== */}
      <Section
        id="navigation"
        kicker="Navigation"
        title="导航与交互"
        description="面包屑、标签页、折叠面板、提示与对话框——带键盘可达性。"
      >
        <div className="space-y-6">
          <Demo
            title="面包屑"
            code={`<Breadcrumbs items={[{label:"首页",to:"/"},{label:"课程"}]} />`}
          >
            <Breadcrumbs
              items={[
                { label: "首页", to: "/" },
                { label: "课程", to: "/#courses" },
                { label: "前端入门" },
              ]}
            />
          </Demo>

          <div className="grid gap-6 lg:grid-cols-2">
            <Demo
              title="标签页"
              code={`<Tabs tabs={[{key:"a",label:"讲解",content:…}]} />`}
            >
              <Tabs
                tabs={[
                  { key: "notes", label: "讲解", content: <p className="text-sm leading-relaxed text-ink-soft dark:text-night-soft">讲解内容区。支持方向键切换标签。</p> },
                  { key: "code", label: "代码", content: <p className="text-sm leading-relaxed text-ink-soft dark:text-night-soft">代码内容区。</p> },
                  { key: "discuss", label: "讨论", content: <p className="text-sm leading-relaxed text-ink-soft dark:text-night-soft">讨论内容区。</p> },
                ]}
              />
            </Demo>

            <Demo
              title="折叠面板"
              code={`<Accordion items={[{title:"第一章",content:…}]} />`}
            >
              <Accordion
                items={[
                  { title: "第一章 · 认识 Web", content: <p className="leading-relaxed">Web 是怎么工作的 → 第一个 HTML 页面 → 第一章小测。</p> },
                  { title: "第二章 · HTML 语义化", content: <p className="leading-relaxed">语义化标签、表单与列表实战。</p> },
                ]}
                defaultOpen={[0]}
              />
            </Demo>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Demo title="提示">
              <div className="flex items-center gap-6 py-4">
                <Tooltip content="复制代码到剪贴板">
                  <Button variant="secondary" size="sm">
                    悬停我
                  </Button>
                </Tooltip>
                <Tooltip content="键盘聚焦也能触发" side="bottom">
                  <Button variant="ghost" size="sm">
                    Tab 到我
                  </Button>
                </Tooltip>
              </div>
            </Demo>

            <Demo
              title="对话框"
              code={`<Dialog open={open} onClose={…} title="标题">
  内容…
</Dialog>`}
            >
              <div className="flex items-center py-4">
                <Button variant="secondary" size="sm" icon={<Bell aria-hidden className="size-4" />} onClick={() => setDialogOpen(true)}>
                  打开对话框
                </Button>
              </div>
              <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="这是一个对话框" description="支持 ESC、遮罩点击关闭与焦点还原">
                <p className="text-sm leading-relaxed text-ink-soft dark:text-night-soft">
                  对话框常用于移动端导航抽屉、课时目录、确认操作等场景。
                </p>
              </Dialog>
            </Demo>

            <Demo title="图标">
              <div className="flex flex-wrap items-center gap-5 py-4 text-ink-soft dark:text-night-soft">
                <ArrowLeft aria-hidden className="size-5" />
                <ArrowRight aria-hidden className="size-5" />
                <Check aria-hidden className="size-5" />
                <LoaderCircle aria-hidden className="size-5 animate-spin" />
                <Sparkles aria-hidden className="size-5" />
              </div>
            </Demo>
          </div>
        </div>
      </Section>

      {/* ==================== 扩展组件 ==================== */}
      <Section
        id="extras"
        kicker="Extras"
        title="扩展组件"
        description="轻提示、记忆卡、课时反馈与首字头像——教学站点的常用补充，全部零依赖。"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Demo
            title="轻提示 Toast"
            code={`// 1) main.tsx 用 <ToastProvider> 包裹应用
// 2) 任意组件里：
const { push } = useToast();
push({ tone: "success", title: "已保存", description: "进度已记录" });`}
          >
            <div className="flex flex-wrap items-center gap-3 py-2">
              <Button size="sm" onClick={() => push({ tone: "success", title: "已保存", description: "你的学习进度已记录。" })}>
                成功提示
              </Button>
              <Button size="sm" variant="secondary" onClick={() => push({ tone: "info", title: "提示", description: "3.8 秒后自动消失。" })}>
                信息提示
              </Button>
              <Button size="sm" variant="danger" onClick={() => push({ tone: "danger", title: "操作失败", description: "网络请求超时，请重试。" })}>
                错误提示
              </Button>
            </div>
          </Demo>

          <Demo
            title="首字头像 Avatar"
            code={`<Avatar name="陈老师" size="md" />
<Avatar name="周助教" size="lg" />`}
          >
            <div className="flex items-center gap-4 py-2">
              <div className="flex items-center gap-2.5">
                <Avatar name="陈老师" size="lg" />
                <div>
                  <p className="text-sm font-medium text-ink dark:text-night-ink">陈老师</p>
                  <p className="text-xs text-ink-faint dark:text-night-faint">课程讲师</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <Avatar name="周助教" />
                <div>
                  <p className="text-sm font-medium text-ink dark:text-night-ink">周助教</p>
                  <p className="text-xs text-ink-faint dark:text-night-faint">答疑助教</p>
                </div>
              </div>
              <Avatar name="林同学" size="sm" />
            </div>
          </Demo>

          <Demo
            title="记忆卡 Flashcard"
            code={`<Flashcard front="什么是主键？" back="唯一标识一行记录的列" />`}
          >
            <div className="mx-auto max-w-sm py-2">
              <Flashcard
                front="什么是主键（PRIMARY KEY）？"
                back="唯一标识一行记录的列：不允许重复、不允许为空，是表之间关联的基础。"
              />
            </div>
          </Demo>

          <Demo
            title="课时反馈 Feedback"
            code={`<Feedback onFeedback={(v) => console.log(v)} />`}
          >
            <div className="py-2">
              <Feedback onFeedback={() => push({ tone: "success", title: "收到反馈", description: "已记录到本地（演示）。" })} />
            </div>
          </Demo>
        </div>
      </Section>
    </div>
  );
}
