import { useState } from "react";
import { ChevronDown, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 练习卡：给出任务与（可选的）提示，提示默认折叠，鼓励先独立思考。
 */
export function Exercise({
  title,
  description,
  hint,
  className,
}: {
  title: string;
  description: string;
  hint?: string;
  className?: string;
}) {
  const [showHint, setShowHint] = useState(false);

  return (
    <section
      aria-label={`练习：${title}`}
      className={cn(
        "rounded-md border border-primary-300/60 bg-primary-50/70 px-5 py-4",
        "dark:border-primary-700 dark:bg-primary-900/25",
        className,
      )}
    >
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary-900 dark:text-primary-200">
        <PencilLine aria-hidden className="size-4" />
        练习 · {title}
      </h4>
      <p className="text-[0.9375rem] leading-relaxed text-ink dark:text-night-ink">
        {description}
      </p>
      {hint && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowHint((v) => !v)}
            aria-expanded={showHint}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 transition-colors hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-200"
          >
            查看提示
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform duration-200",
                showHint && "rotate-180",
              )}
            />
          </button>
          {showHint && (
            <p className="mt-2 rounded bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink-soft dark:bg-night-surface dark:text-night-soft">
              {hint}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
