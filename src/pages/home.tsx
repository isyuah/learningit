import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Atom,
  Bot,
  CheckCircle2,
  Feather,
  PlayCircle,
  Search,
  SearchX,
  Wind,
} from "lucide-react";
import { site } from "@/content/site";
import {
  courseSortValue,
  flattenLessons,
  getCourse,
  orderedCourses,
  type CourseSort,
} from "@/content/courses";
import { useProgress } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { LinkButton } from "@/components/ui/button";
import { CourseCard, countLessons } from "@/components/learning/course-card";
import { Select } from "@/components/ui/select";
import { CodeBlock } from "@/components/learning/code-block";
import { LessonBlocks } from "@/components/learning/lesson-blocks";
import { Quiz } from "@/components/learning/quiz";

/* ------------------------------------------------------------------ */

function SectionHeading({
  kicker,
  title,
  description,
  align = "left",
}: {
  kicker: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn(align === "center" && "mx-auto max-w-2xl text-center")}>
      <p className="text-xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-300">
        {kicker}
      </p>
      <h2 className="mt-2 font-display text-2xl font-semibold leading-snug text-ink sm:text-3xl dark:text-night-ink">
        {title}
      </h2>
      {description && (
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-soft dark:text-night-soft">
          {description}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** 首页右侧「进行中的课程」面板：真实的产品画面 */
function HeroCoursePanel() {
  const course = getCourse("frontend-basics");
  if (!course) return null;
  const flat = flattenLessons(course);
  const { completed } = useProgress();
  const done = flat.filter((l) => completed.has(l.meta.slug)).length;
  const pct = Math.round((done / flat.length) * 100);
  const next = flat.find((l) => !completed.has(l.meta.slug));

  return (
    <div aria-hidden className="relative">
      {/* 背后露出一角的代码卡 */}
      <div className="absolute -top-6 -right-2 hidden w-56 -rotate-3 lg:block">
        <CodeBlock
          code={`<article>
  <h1>你好，世界</h1>
</article>`}
          language="html"
          title="index.html"
          className="shadow-lift"
        />
      </div>

      <Card className="relative rotate-1 rounded-xl p-5 shadow-lift">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.6875rem] font-semibold tracking-wider text-ink-faint uppercase dark:text-night-faint">
              继续学习
            </p>
            <h3 className="mt-1 text-base font-semibold text-ink dark:text-night-ink">
              {course.title}
            </h3>
          </div>
          <span className="font-display text-3xl font-semibold text-primary-300 dark:text-primary-800">
            {course.coverIndex}
          </span>
        </div>

        <div className="mt-4">
          <ProgressBar value={pct} showLabel label="课程进度" />
          <p className="mt-1.5 text-xs text-ink-faint dark:text-night-faint">
            已完成 {done} / {flat.length} 节
          </p>
        </div>

        <ul className="mt-4 space-y-1 border-t border-line pt-3 dark:border-night-line">
          {flat.slice(0, 3).map((l) => {
            const isDone = completed.has(l.meta.slug);
            const isNext = next?.meta.slug === l.meta.slug;
            return (
              <li
                key={l.meta.slug}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
              >
                {isDone ? (
                  <CheckCircle2 aria-hidden className="size-4 text-success" />
                ) : isNext ? (
                  <PlayCircle aria-hidden className="size-4 text-primary-700 dark:text-primary-300" />
                ) : (
                  <span aria-hidden className="size-1.5 rounded-full bg-line-strong dark:bg-night-line-strong" />
                )}
                <span
                  className={cn(
                    "truncate",
                    isNext
                      ? "font-medium text-ink dark:text-night-ink"
                      : "text-ink-soft dark:text-night-soft",
                  )}
                >
                  {l.meta.title}
                </span>
              </li>
            );
          })}
        </ul>

        <LinkButton to="/courses/frontend-basics" size="sm" className="mt-4 w-full">
          {next ? "继续这节课" : "重新回顾课程"}
          <ArrowRight aria-hidden className="size-4" />
        </LinkButton>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function HomePage() {
  const featured = getCourse("frontend-basics");
  const pedagogy = site.pedagogy;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CourseSort>("default");
  const visibleCourses = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const filtered = q
      ? orderedCourses.filter((c) =>
          [c.title, c.tagline, c.description, c.level]
            .join("\n")
            .toLocaleLowerCase()
            .includes(q),
        )
      : orderedCourses;
    return [...filtered].sort(
      (a, b) => courseSortValue(a, sort) - courseSortValue(b, sort),
    );
  }, [query, sort]);

  return (
    <>
      {/* ============================ Hero ============================ */}
      <section className="relative overflow-hidden bg-linear-to-b from-primary-50 via-canvas to-canvas">
        <div className="wrap grid items-center gap-12 pb-16 pt-14 sm:pt-20 lg:grid-cols-[1.15fr_0.85fr] lg:pb-24">
          <div className="animate-rise-in">
            {site.hero.kicker && (
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-soft dark:border-night-line dark:bg-night-surface dark:text-night-soft">
                <span className="size-1.5 rounded-full bg-primary-500" aria-hidden />
                {site.hero.kicker}
              </p>
            )}
            <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.18] text-ink sm:text-5xl sm:leading-[1.15] dark:text-night-ink">
              {site.hero.title[0]}
              <br />
              <span className="inline-block bg-linear-to-t from-amber-200/70 via-amber-200/70 to-transparent bg-[length:100%_0.55em] bg-[position:0_0.72em] bg-no-repeat px-1">
                {site.hero.title[1]}
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-[1.0625rem] leading-8 text-ink-soft dark:text-night-soft">
              {site.hero.description}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton to={site.hero.primaryCta.to} size="lg">
                {site.hero.primaryCta.label}
                <ArrowRight aria-hidden className="size-4.5" />
              </LinkButton>
              <LinkButton to={site.hero.secondaryCta.to} variant="secondary" size="lg">
                {site.hero.secondaryCta.label}
              </LinkButton>
            </div>

            {site.hero.stats.length > 0 && (
              <dl className="mt-12 flex divide-x divide-line dark:divide-night-line">
                {site.hero.stats.map((stat) => (
                  <div key={stat.label} className="pr-6 pl-6 first:pl-0">
                    <dd className="font-display text-2xl font-semibold text-ink dark:text-night-ink">
                      {stat.value}
                    </dd>
                    <dt className="mt-0.5 text-xs text-ink-faint dark:text-night-faint">
                      {stat.label}
                    </dt>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="animate-rise-in pt-6 lg:pt-0 [animation-delay:120ms]">
            <HeroCoursePanel />
          </div>
        </div>
      </section>

      {/* ======================= 课程总览 ======================= */}
      <section id="courses" className="scroll-mt-20 border-t border-line bg-surface/60 py-16 sm:py-20 dark:border-night-line dark:bg-night/40">
        <div className="wrap">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading
              kicker="课程总览"
              title="按自己的节奏，一门课一门课地学"
              description="示例课程用于演示页面结构。替换 docs/CONTENT-AUTHORING.md 中的步骤，即可换成你自己的课程。"
            />
            <Link
              to="/guide"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 transition-colors hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-200"
            >
              如何添加课程 <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>

          {/* 搜索 + 排序 */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block w-full max-w-sm sm:max-w-xs">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint dark:text-night-faint"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索课程：标题、简介、难度…"
                className="h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink transition-colors outline-none placeholder:text-ink-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-night-line-strong dark:bg-night-surface-2 dark:text-night-ink dark:placeholder:text-night-faint dark:focus:border-primary-400 dark:focus:ring-primary-900"
              />
            </label>
            <Select
              value={sort}
              onChange={(value) => setSort(value as CourseSort)}
              options={[
                { value: "default", label: "默认排序" },
                { value: "newest", label: "最近更新" },
                { value: "oldest", label: "最早创建" },
              ]}
              className="w-full sm:w-40"
              aria-label="课程排序"
            />
          </div>

          {visibleCourses.length > 0 ? (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCourses.map((course) => (
                <CourseCard
                  key={course.slug}
                  course={course}
                  lessonsCount={countLessons(course)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-dashed border-line py-16 text-center dark:border-night-line-strong">
              <SearchX aria-hidden className="size-8 text-ink-faint dark:text-night-faint" />
              <p className="text-sm text-ink-soft dark:text-night-soft">
                没有找到与「{query.trim()}」匹配的课程
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSort("default");
                }}
                className="link text-sm"
              >
                清除搜索与筛选
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ===================== 课时设计 ===================== */}
      <section className="py-16 sm:py-20">
        <div className="wrap grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="min-w-0">
            <SectionHeading
              kicker={pedagogy.kicker}
              title={pedagogy.title}
              description={pedagogy.description}
            />
            <ol className="mt-8 space-y-0">
              {pedagogy.points.map((point, i) => (
                <li
                  key={point.title}
                  className="flex gap-5 border-t border-line py-5 first:border-t-0 dark:border-night-line"
                >
                  <span className="font-display text-xl font-semibold text-primary-300 dark:text-primary-700">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-medium text-ink dark:text-night-ink">
                      {point.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft dark:text-night-soft">
                      {point.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <LinkButton to="/components" variant="secondary" className="mt-8">
              查看全部教学组件
              <ArrowRight aria-hidden className="size-4" />
            </LinkButton>
          </div>

          {/* 课时解剖：真实渲染内容块，展示「一节课长什么样」 */}
          <div className="min-w-0 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-ink-faint uppercase dark:text-night-faint">
              <span className="size-1.5 rounded-full bg-amber-400" aria-hidden />
              一节课的真实组成
            </div>
            <LessonBlocks
              blocks={[
                {
                  type: "callout",
                  variant: "tip",
                  title: "小贴士",
                  body: "每节课都可以由讲解、代码、要点、练习与测验自由组合——内容块是结构化的，改起来像搭积木。",
                },
                {
                  type: "code",
                  language: "ts",
                  title: "lesson.ts · 内容即数据",
                  code: `{
  type: "keypoints",
  items: ["要点先行，先声明目标"],
}, {
  type: "quiz",
  question: "内容块是什么？",
  options: ["一段 HTML", "结构化的数据", "一张图片"],
  answer: 1,
  explanation: "每个块都是数据，由组件渲染。",
}`,
                },
              ]}
            />
            <Card className="p-0">
              <Quiz
                question="这个互动测验演示了什么？"
                options={[
                  "模板可以嵌入交互练习",
                  "这只是静态文字",
                  "需要后端才能工作",
                ]}
                answer={0}
                explanation="答完即可看到即时反馈与讲解——这正是教学站点该有的学习体验。"
              />
            </Card>
          </div>
        </div>
      </section>

      {/* ======================= 技术条 ======================= */}
      <section className="border-y border-line bg-canvas-2/70 py-10 dark:border-night-line dark:bg-night-2">
        <div className="wrap grid grid-cols-2 gap-6 lg:grid-cols-4">
          {[
            { icon: Atom, label: "React 19", sub: "组件化，生态成熟" },
            { icon: Wind, label: "Tailwind CSS v4", sub: "CSS 优先，零配置" },
            { icon: Feather, label: "零 UI 依赖", sub: "全部组件自研可控" },
            { icon: Bot, label: "LLM 友好文档", sub: "课程文档与 Agent 协作" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-primary-700 shadow-card dark:bg-night-surface dark:text-primary-300">
                <item.icon aria-hidden className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink dark:text-night-ink">
                  {item.label}
                </p>
                <p className="text-xs text-ink-faint dark:text-night-faint">
                  {item.sub}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ======================= CTA ======================= */}
      <section className="py-16 sm:py-20">
        <div className="wrap">
          <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-primary-700 to-primary-800 px-6 py-14 text-center shadow-lift sm:px-12">
            <span
              aria-hidden
              className="pointer-events-none absolute -top-10 right-4 font-display text-[10rem] leading-none font-semibold text-white/8 select-none"
            >
              {featured?.coverIndex ?? "04"}
            </span>
            <h2 className="relative font-display text-2xl font-semibold text-white sm:text-3xl">
              开始搭建你自己的教学网站
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-primary-100">
              这份模板已经替你准备好了页面结构、组件与文档。复制仓库、按文档填内容，几天内就能上线。
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <LinkButton
                to="/guide"
                className="bg-white text-primary-900 hover:bg-primary-50"
              >
                阅读使用指南 <ArrowRight aria-hidden className="size-4" />
              </LinkButton>
              <LinkButton
                to="/components"
                className="border border-white/25 bg-transparent text-white hover:bg-white/10"
              >
                浏览组件库
              </LinkButton>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
