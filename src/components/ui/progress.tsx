import { cn } from "@/lib/utils";

/** 进度条（确定进度） */
export function ProgressBar({
  value,
  className,
  barClassName,
  showLabel,
  label,
}: {
  /** 0 - 100 */
  value: number;
  className?: string;
  barClassName?: string;
  showLabel?: boolean;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "进度"}
      className={cn("flex items-center gap-3", className)}
    >
      <div
        className={cn(
          "h-2 flex-1 overflow-hidden rounded-full bg-canvas-2 dark:bg-night-surface-2",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary-600 transition-[width] duration-300",
            "dark:bg-primary-500",
            barClassName,
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs tabular-nums text-ink-faint dark:text-night-faint">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  );
}

/** 环形进度（小尺寸，用于课程卡片等） */
export function ProgressRing({
  value,
  size = 44,
  strokeWidth = 4,
  className,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="进度"
      className={cn("relative", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-canvas-deep dark:stroke-night-surface-2"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="stroke-primary-600 transition-[stroke-dashoffset] duration-300 dark:stroke-primary-400"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[0.6875rem] font-semibold tabular-nums text-ink dark:text-night-ink">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
