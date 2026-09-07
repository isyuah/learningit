import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 空状态：告诉使用者「这里为什么是空的 + 下一步做什么」。
 * 模板的占位课时就用它来引导用户填充内容。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-8 py-14 text-center",
        "dark:border-night-line-strong",
        className,
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-canvas-2 text-ink-faint dark:bg-night-surface-2 dark:text-night-faint">
        {icon ?? <Inbox className="size-6" aria-hidden />}
      </div>
      <h3 className="text-base font-semibold text-ink dark:text-night-ink">
        {title}
      </h3>
      {description && (
        <div className="mt-1.5 max-w-md text-sm text-ink-soft dark:text-night-soft">
          {description}
        </div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
