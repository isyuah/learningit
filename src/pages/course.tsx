import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, Layers, Users } from "lucide-react";
import { flattenLessons, getCourse } from "@/content/courses";
import { LEVEL_LABEL } from "@/content/types";
import { useProgress } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { CourseHero, totalMinutes } from "@/components/learning/course-card";
import { LessonList } from "@/components/learning/lesson-list";
import { EmptyState } from "@/components/ui/empty-state";

export function CoursePage({ courseSlug }: { courseSlug: string }) {
  const course = getCourse(courseSlug);
  const { completed } = useProgress();

  if (!course) {
    return (
      <div className="wrap py-24">
        <EmptyState
          title="课程不存在"
          description={`没有找到 slug 为「${courseSlug}」的课程。检查 src/content/courses/<course-slug>/course.ts 与课程目录。`}
          action={
            <LinkButton to="/#courses" variant="secondary">
              返回课程总览
            </LinkButton>
          }
        />
      </div>
    );
  }

  const flat = flattenLessons(course);
  const total = flat.length;
  const done = flat.filter((l) => completed.has(l.meta.slug)).length;
  const pct = Math.round((done / total) * 100);
  const nextLesson =
    flat.find((l) => !completed.has(l.meta.slug) && !l.meta.locked) ?? flat[0];
  const startHref = `/courses/${course.slug}/lessons/${nextLesson.meta.slug}`;
  const paragraphs = course.description.split("\n").filter((p) => p.trim());

  return (
    <div className="wrap pb-20 pt-8">
      <Breadcrumbs
        items={[
          { label: "首页", to: "/" },
          { label: "课程", to: "/#courses" },
          { label: course.title },
        ]}
      />

      <div className="mt-6">
        <CourseHero course={course} lessonsCount={total} />
      </div>

      {/* 标题区 */}
      <div className="mt-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{LEVEL_LABEL[course.level]}</Badge>
          <Badge tone="neutral">约 {course.hours} 小时</Badge>
          <Badge tone="neutral">{total} 节</Badge>
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-snug text-ink sm:text-4xl dark:text-night-ink">
          {course.title}
        </h1>
        <p className="mt-2 text-lg text-ink-soft dark:text-night-soft">
          {course.tagline}
        </p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_20rem]">
        {/* 左侧主内容 */}
        <div className="min-w-0 space-y-10">
          <section aria-label="课程介绍">
            <h2 className="mb-3 text-lg font-semibold text-ink dark:text-night-ink">
              课程介绍
            </h2>
            <div className="space-y-4">
              {paragraphs.map((p, i) => (
                <p key={i} className="leading-8 text-ink-soft dark:text-night-soft">
                  {p}
                </p>
              ))}
            </div>
          </section>

          {course.outcomes && course.outcomes.length > 0 && (
            <section aria-label="你将学到">
              <h2 className="mb-3 text-lg font-semibold text-ink dark:text-night-ink">
                你将学到
              </h2>
              <Card className="p-5">
                <ul className="grid gap-3 sm:grid-cols-2">
                  {course.outcomes.map((o) => (
                    <li key={o} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft dark:text-night-soft">
                      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-600 dark:text-primary-400" />
                      {o}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          <section aria-label="课程大纲" className="scroll-mt-24">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold text-ink dark:text-night-ink">
                课程大纲
              </h2>
              <span className="text-xs text-ink-faint dark:text-night-faint">
                已完成 {done} / {total}
              </span>
            </div>
            <LessonList course={course} completed={completed} />
            <p className="mt-6 rounded-md border border-dashed border-line-strong px-4 py-3 text-xs leading-relaxed text-ink-faint dark:border-night-line-strong dark:text-night-faint">
              提示：大纲中的部分课时是「示例占位」，点击会看到一个空状态引导页。用
              docs/CONTENT-AUTHORING.md 中的方法为每个 slug 补充内容即可。
            </p>
          </section>
        </div>

        {/* 右侧信息栏 */}
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink dark:text-night-ink">
              你的学习进度
            </h2>
            <ProgressBar
              value={pct}
              showLabel
              label="课程进度"
              className="mt-3"
            />
            <p className="mt-2 text-xs text-ink-faint dark:text-night-faint">
              进度保存在本机浏览器中（localStorage），无需登录。
            </p>
            <LinkButton to={startHref} className="mt-4 w-full">
              {done > 0 ? "继续学习" : "开始学习"}
              <ArrowRight aria-hidden className="size-4" />
            </LinkButton>
          </Card>

          <Card className="divide-y divide-line dark:divide-night-line">
            {[
              { icon: Layers, label: "难度", value: LEVEL_LABEL[course.level] },
              { icon: Clock3, label: "总时长", value: `约 ${course.hours} 小时（${totalMinutes(course)} 分钟）` },
              { icon: Users, label: "学习人数", value: course.learners?.toLocaleString("zh-CN") ?? "—" },
              { icon: CalendarDays, label: "最近更新", value: course.updatedAt },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3 px-5 py-3.5">
                <row.icon aria-hidden className="size-4 shrink-0 text-ink-faint dark:text-night-faint" />
                <span className="w-16 shrink-0 text-xs text-ink-faint dark:text-night-faint">
                  {row.label}
                </span>
                <span className={cn("text-sm text-ink dark:text-night-ink")}>
                  {row.value}
                </span>
              </div>
            ))}
          </Card>

          <Link to="/#courses" className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 transition-colors hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-200">
            返回课程总览 <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
