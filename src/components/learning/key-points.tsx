import { Check, Target } from "lucide-react";
import { cn } from "@/lib/utils";

/** 本课要点：讲解前先声明学习目标，讲解后总结核心结论 */
export function KeyPoints({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  return (
    <section
      aria-label="本课要点"
      className={cn(
        "rounded-md border border-amber-300/60 bg-amber-100/60 px-5 py-4",
        "dark:border-amber-600/40 dark:bg-amber-600/10",
        className,
      )}
    >
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink dark:text-night-ink">
        <Target aria-hidden className="size-4 text-amber-600 dark:text-amber-400" />
        本课要点
      </h4>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-[0.9375rem] leading-relaxed text-ink dark:text-night-ink"
          >
            <Check
              aria-hidden
              className="mt-1 size-4 shrink-0 text-primary-600 dark:text-primary-400"
            />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
