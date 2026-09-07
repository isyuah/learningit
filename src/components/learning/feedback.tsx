import { useState } from "react";
import { CheckCircle2, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeedbackValue = "helpful" | "not-helpful";

/**
 * 课时反馈：一节课末尾问「有帮助吗」，轻量收集反馈。
 * 纯前端状态；接入后端时把 onFeedback 接上即可。
 */
export function Feedback({
  onFeedback,
  className,
}: {
  onFeedback?: (value: FeedbackValue) => void;
  className?: string;
}) {
  const [picked, setPicked] = useState<FeedbackValue | null>(null);

  if (picked) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg border border-success/40 bg-success-soft px-5 py-3.5 dark:border-success/40 dark:bg-success/10",
          className,
        )}
      >
        <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" />
        <p className="text-sm text-ink dark:text-night-ink">
          感谢反馈！我们会参考它改进这节课。
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-3.5 dark:border-night-line dark:bg-night-surface",
        className,
      )}
    >
      <p className="text-sm text-ink-soft dark:text-night-soft">
        这节课对你有帮助吗？
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setPicked("helpful");
            onFeedback?.("helpful");
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary-400 hover:text-primary-700 dark:border-night-line-strong dark:bg-night-surface dark:text-night-soft dark:hover:border-primary-500 dark:hover:text-primary-200"
        >
          <ThumbsUp aria-hidden className="size-3.5" /> 有帮助
        </button>
        <button
          type="button"
          onClick={() => {
            setPicked("not-helpful");
            onFeedback?.("not-helpful");
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-primary-400 hover:text-primary-700 dark:border-night-line-strong dark:bg-night-surface dark:text-night-soft dark:hover:border-primary-500 dark:hover:text-primary-200"
        >
          <ThumbsDown aria-hidden className="size-3.5" /> 一般
        </button>
      </div>
    </div>
  );
}
