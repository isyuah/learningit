import { BookMarked } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineMd } from "./inline-content";

/** 术语条目：术语 + 定义，适合课程中的概念速查 */
export function Definition({
  term,
  definition,
  courseSlug,
  className,
}: {
  term: string;
  definition: string;
  courseSlug?: string;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-1 rounded-md border-l-2 border-amber-400 bg-surface px-4.5 py-3 shadow-card sm:grid-cols-[10rem_1fr] sm:gap-4",
        "dark:border-amber-500 dark:bg-night-surface",
        className,
      )}
    >
      <dt className="flex items-start gap-1.5 font-semibold text-ink dark:text-night-ink">
        <BookMarked
          aria-hidden
          className="mt-1 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <span className="break-all">{term}</span>
      </dt>
      <dd className="text-[0.9375rem] leading-relaxed text-ink-soft dark:text-night-soft">
        <InlineMd text={definition} courseSlug={courseSlug} />
      </dd>
    </dl>
  );
}
