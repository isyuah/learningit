import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "amber"
  | "success"
  | "warning"
  | "danger"
  | "info";

const toneClasses: Record<BadgeTone, string> = {
  neutral:
    "bg-canvas-2 text-ink-soft border-line dark:bg-night-surface-2 dark:text-night-soft dark:border-night-line",
  primary:
    "bg-primary-100 text-primary-800 border-primary-200 dark:bg-primary-900/60 dark:text-primary-200 dark:border-primary-800",
  amber:
    "bg-amber-100 text-amber-600 border-amber-200 dark:bg-amber-600/15 dark:text-amber-300 dark:border-amber-600/30",
  success:
    "bg-success-soft text-success border-[#c6e3d2] dark:bg-success/15 dark:text-[#86D6A7] dark:border-success/30",
  warning:
    "bg-warning-soft text-warning border-[#ecd9ac] dark:bg-warning/15 dark:text-[#d9ae5c] dark:border-warning/30",
  danger:
    "bg-danger-soft text-danger border-[#ecc9c1] dark:bg-danger/15 dark:text-[#E49A8C] dark:border-danger/30",
  info:
    "bg-info-soft text-info border-[#c4d8e6] dark:bg-info/15 dark:text-[#8fb9d6] dark:border-info/30",
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** 前置小圆点（语义强调时使用，勿作装饰堆砌） */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-current opacity-70"
        />
      )}
      {children}
    </span>
  );
}
