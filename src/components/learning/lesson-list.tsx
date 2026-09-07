import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Circle,
  FileText,
  Lock,
  MonitorPlay,
  NotebookPen,
  PlayCircle,
} from "lucide-react";
import type { Course, LessonKind, LessonMeta } from "@/content/types";
import { cn } from "@/lib/utils";

const kindIcon: Record<LessonKind, typeof FileText> = {
  reading: FileText,
  video: MonitorPlay,
  exercise: NotebookPen,
  quiz: PlayCircle,
};

/** 单个课时行：状态（当前 / 已完成 / 锁定）一目了然 */
export function LessonRow({
  courseSlug,
  meta,
  active,
  completed,
  className,
}: {
  courseSlug: string;
  meta: LessonMeta;
  active?: boolean;
  completed?: boolean;
  className?: string;
}) {
  const Icon = kindIcon[meta.kind];
  const locked = meta.locked;

  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center",
          completed
            ? "text-success"
            : locked
              ? "text-ink-faint dark:text-night-faint"
              : active
                ? "text-primary-700 dark:text-primary-300"
                : "text-ink-faint dark:text-night-faint",
        )}
      >
        {locked ? (
          <Lock className="size-4" />
        ) : completed ? (
          <CheckCircle2 className="size-4.5" />
        ) : active ? (
          <PlayCircle className="size-4.5" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm leading-snug",
            active
              ? "font-semibold text-primary-800 dark:text-primary-200"
              : completed
                ? "text-ink-soft dark:text-night-soft"
                : locked
                  ? "text-ink-faint dark:text-night-faint"
                  : "text-ink dark:text-night-ink",
          )}
        >
          {meta.title}
        </span>
        {!locked && (
          <span className="mt-0.5 block text-xs text-ink-faint dark:text-night-faint">
            {meta.minutes} 分钟
          </span>
        )}
      </span>
      {active && (
        <span className="size-1.5 shrink-0 rounded-full bg-primary-600 dark:bg-primary-400" />
      )}
    </>
  );

  if (locked) {
    return (
      <li className={cn("flex cursor-not-allowed items-center gap-3 px-4 py-2.5", className)}>
        {content}
      </li>
    );
  }

  return (
    <li>
      <Link
        to={`/courses/${courseSlug}/lessons/${meta.slug}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-md px-4 py-2.5 transition-colors",
          active
            ? "bg-primary-100/80 dark:bg-primary-900/40"
            : "hover:bg-canvas-2 dark:hover:bg-night-surface-2",
          className,
        )}
      >
        {content}
      </Link>
    </li>
  );
}

/** 课程大纲：章节分组 + 课时列表（课程页与侧边栏共用） */
export function LessonList({
  course,
  activeSlug,
  completed,
  className,
}: {
  course: Course;
  activeSlug?: string;
  completed: Set<string>;
  className?: string;
}) {
  return (
    <nav aria-label="课程大纲" className={cn("space-y-4", className)}>
      {course.chapters.map((chapter, ci) => (
        <section key={chapter.id}>
          <div className="mb-1.5 flex items-center gap-2 px-4">
            <span className="font-display text-sm font-semibold text-ink-faint dark:text-night-faint">
              {String(ci + 1).padStart(2, "0")}
            </span>
            <h3 className="truncate text-sm font-semibold text-ink dark:text-night-ink">
              {chapter.title}
            </h3>
          </div>
          <ul className="space-y-0.5 border-l border-line pl-2 dark:border-night-line">
            {chapter.lessons.map((meta) => (
              <LessonRow
                key={meta.slug}
                courseSlug={course.slug}
                meta={meta}
                active={activeSlug === meta.slug}
                completed={completed.has(meta.slug)}
              />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** 大纲顶部的课程信息条（侧边栏用） */
export function SidebarCourseCard({ course }: { course: Course }) {
  return (
    <div className="border-b border-line px-4 py-4 dark:border-night-line">
      <Link
        to={`/courses/${course.slug}`}
        className="group block"
      >
        <p className="text-[0.6875rem] font-semibold tracking-wider text-ink-faint uppercase dark:text-night-faint">
          课程 · {course.coverIndex}
        </p>
        <h2 className="mt-1 line-clamp-2 text-[0.9375rem] font-semibold leading-snug text-ink transition-colors group-hover:text-primary-800 dark:text-night-ink dark:group-hover:text-primary-200">
          {course.title}
        </h2>
      </Link>
    </div>
  );
}

/** 侧边栏底部：标记完成状态的小提示 */
export function SidebarProgress({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-ink-faint dark:text-night-faint">
      <Circle aria-hidden className="size-3.5" />
      已完成 {done} / {total} 节
    </div>
  );
}
