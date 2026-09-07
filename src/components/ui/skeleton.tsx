import { cn } from "@/lib/utils";

/** 骨架屏：加载占位，保持布局稳定 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-canvas-2 dark:bg-night-surface-2",
        className,
      )}
    />
  );
}

/** 加载指示器 */
export function Spinner({
  className,
  label = "加载中",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 text-sm text-ink-soft dark:text-night-soft",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {label}
    </span>
  );
}
