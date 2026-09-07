import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Clock3 } from "lucide-react";
import type { Course, CoverColor } from "@/content/types";
import { LEVEL_LABEL } from "@/content/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const coverStyles: Record<
  CoverColor,
  { bg: string; text: string; rule: string }
> = {
  primary: {
    bg: "bg-primary-100 dark:bg-primary-900/40",
    text: "text-primary-800 dark:text-primary-200",
    rule: "bg-primary-600/25 dark:bg-primary-400/30",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-600/15",
    text: "text-amber-600 dark:text-amber-300",
    rule: "bg-amber-500/30 dark:bg-amber-400/30",
  },
  info: {
    bg: "bg-info-soft dark:bg-info/15",
    text: "text-info dark:text-[#8fb9d6]",
    rule: "bg-info/30 dark:bg-info/30",
  },
  success: {
    bg: "bg-success-soft dark:bg-success/15",
    text: "text-success dark:text-[#86D6A7]",
    rule: "bg-success/30 dark:bg-success/30",
  },
  danger: {
    bg: "bg-danger-soft dark:bg-danger/15",
    text: "text-danger dark:text-[#E49A8C]",
    rule: "bg-danger/25 dark:bg-danger/30",
  },
};

/** 课程卡片：文字封面 + 课程信息，是首页/课程列表的主力卡片 */
export function CourseCard({
  course,
  lessonsCount,
  className,
}: {
  course: Course;
  lessonsCount: number;
  className?: string;
}) {
  const style = coverStyles[course.coverColor];
  return (
    <Link
      to={`/courses/${course.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-lift hover:border-primary-300",
        "dark:border-night-line dark:bg-night-surface dark:hover:border-primary-700",
        className,
      )}
    >
      {/* 文字封面：不依赖图片素材，模板开箱即用 */}
      <div
        aria-hidden
        className={cn(
          "relative flex h-36 items-end overflow-hidden px-5 pb-4",
          style.bg,
        )}
      >
        <span
          className={cn(
            "pointer-events-none absolute -right-3 -top-6 font-display text-[7rem] leading-none font-semibold opacity-80 select-none",
            style.text,
          )}
        >
          {course.coverIndex}
        </span>
        <div className="relative flex flex-wrap gap-1.5">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wider",
              style.text,
              style.rule,
            )}
          >
            课程 {course.coverIndex}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 py-4">
        <h3 className="text-[1.0625rem] font-semibold leading-snug text-ink transition-colors group-hover:text-primary-800 dark:text-night-ink dark:group-hover:text-primary-200">
          {course.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-soft dark:text-night-soft">
          {course.tagline}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-faint dark:text-night-faint">
          <Badge tone="neutral">{LEVEL_LABEL[course.level]}</Badge>
          <span className="inline-flex items-center gap-1">
            <Clock3 aria-hidden className="size-3.5" />
            {course.hours} 小时 · {lessonsCount} 节
          </span>
          {course.learners !== undefined && (
            <span>{course.learners.toLocaleString("zh-CN")} 人学习</span>
          )}
          {(() => {
            const [year, month] = course.updatedAt.split("-");
            return (
              <span
                className="inline-flex items-center gap-1"
                title="最近更新时间"
              >
                <CalendarDays aria-hidden className="size-3.5" />
                更新于 {year} 年 {month} 月
              </span>
            );
          })()}
        </div>

        <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary-700 dark:text-primary-300">
          开始学习
          <ArrowRight
            aria-hidden
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </Link>
  );
}

/** 课程页顶部的「大卡片」封面横幅 */
export function CourseHero({
  course,
  lessonsCount,
}: {
  course: Course;
  lessonsCount: number;
}) {
  const style = coverStyles[course.coverColor];
  return (
    <div
      aria-hidden
      className={cn(
        "relative flex min-h-44 items-end overflow-hidden rounded-lg px-6 pb-5 sm:min-h-52 sm:px-8",
        style.bg,
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute -right-2 -top-10 font-display text-[10rem] leading-none font-semibold opacity-90 select-none sm:text-[13rem]",
          style.text,
        )}
      >
        {course.coverIndex}
      </span>
      <span
        className={cn(
          "relative rounded px-2 py-0.5 text-xs font-semibold tracking-wider",
          style.text,
          style.rule,
        )}
      >
        课程 {course.coverIndex} · 共 {lessonsCount} 节
      </span>
    </div>
  );
}

/** 计算课程总课时数（导出给页面使用） */
export function countLessons(course: Course): number {
  return course.chapters.reduce((n, c) => n + c.lessons.length, 0);
}

/** 计算课程总时长（分钟） */
export function totalMinutes(course: Course): number {
  return course.chapters.reduce(
    (n, c) => n + c.lessons.reduce((m, l) => m + l.minutes, 0),
    0,
  );
}
