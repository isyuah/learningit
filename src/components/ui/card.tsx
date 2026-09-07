import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 卡片容器：纸面、细边框、轻微圆角，不用厚重阴影 */
export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface shadow-card",
        "dark:border-night-line dark:bg-night-surface",
        className,
      )}
      {...props}
    />
  );
}

/** 卡片标题区：标题 + 可选描述 + 可选右侧操作 */
export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-line px-5 py-4",
        "dark:border-night-line",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-[0.9375rem] font-semibold text-ink dark:text-night-ink">
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-sm text-ink-soft dark:text-night-soft">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-line px-5 py-3.5",
        "dark:border-night-line",
        className,
      )}
      {...props}
    />
  );
}
