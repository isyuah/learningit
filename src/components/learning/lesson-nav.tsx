import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { flattenLessons } from "@/content/courses";
import type { Course } from "@/content/types";
import { cn } from "@/lib/utils";

/**
 * 课时底部导航：上一课 / 下一课。
 * 根据课程大纲顺序自动计算前后课时。
 */
export function LessonNav({
  course,
  currentSlug,
}: {
  course: Course;
  currentSlug: string;
}) {
  const flat = flattenLessons(course);
  const idx = flat.findIndex((l) => l.meta.slug === currentSlug);
  const prev = idx > 0 ? flat[idx - 1] : undefined;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : undefined;

  const cell = cn(
    "group flex flex-col gap-1 rounded-md border border-line bg-surface px-4 py-3.5 transition-all",
    "dark:border-night-line dark:bg-night-surface",
  );

  return (
    <nav
      aria-label="课时导航"
      className="grid gap-3 border-t border-line pt-6 sm:grid-cols-2 dark:border-night-line"
    >
      {prev && !prev.meta.locked ? (
        <Link
          to={`/courses/${course.slug}/lessons/${prev.meta.slug}`}
          className={cn(cell, "hover:border-primary-300 dark:hover:border-primary-700")}
        >
          <span className="flex items-center gap-1 text-xs text-ink-faint dark:text-night-faint">
            <ArrowLeft aria-hidden className="size-3.5" /> 上一课
          </span>
          <span className="truncate text-sm font-medium text-ink transition-colors group-hover:text-primary-800 dark:text-night-ink dark:group-hover:text-primary-200">
            {prev.meta.title}
          </span>
        </Link>
      ) : (
        <div className={cn(cell, "opacity-45")} aria-hidden>
          <span className="flex items-center gap-1 text-xs">上一课</span>
          <span className="truncate text-sm font-medium">已到第一课</span>
        </div>
      )}

      {next && !next.meta.locked ? (
        <Link
          to={`/courses/${course.slug}/lessons/${next.meta.slug}`}
          className={cn(cell, "sm:text-right hover:border-primary-300 dark:hover:border-primary-700")}
        >
          <span className="flex items-center justify-end gap-1 text-xs text-ink-faint dark:text-night-faint">
            下一课 <ArrowRight aria-hidden className="size-3.5" />
          </span>
          <span className="truncate text-sm font-medium text-ink transition-colors group-hover:text-primary-800 dark:text-night-ink dark:group-hover:text-primary-200">
            {next.meta.title}
          </span>
        </Link>
      ) : (
        <div className={cn(cell, "opacity-45 sm:text-right")} aria-hidden>
          <span className="flex items-center justify-end gap-1 text-xs">下一课</span>
          <span className="truncate text-sm font-medium">本课是最后一节</span>
        </div>
      )}
    </nav>
  );
}
