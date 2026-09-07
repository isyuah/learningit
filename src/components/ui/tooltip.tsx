import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 提示（Tooltip）：纯 CSS 实现，hover / 键盘聚焦均可触发。
 * 注意：按钮等可聚焦元素自带 focus-visible 描边，配合使用。
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-ink px-2.5 py-1 text-xs text-canvas shadow-card",
          "opacity-0 transition-opacity duration-150",
          "group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          "dark:border-night-line-strong dark:bg-night-ink dark:text-night",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {content}
      </span>
    </span>
  );
}
