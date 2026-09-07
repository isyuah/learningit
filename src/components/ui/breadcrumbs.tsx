import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: ReactNode;
  to?: string;
}

/** 面包屑：展示当前位置与层级 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: Crumb[];
  className?: string;
}) {
  return (
    <nav aria-label="面包屑" className={cn("flex items-center gap-1.5 text-sm", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <ChevronRight
                  aria-hidden
                  className="size-3.5 text-ink-faint dark:text-night-faint"
                />
              )}
              {item.to && !last ? (
                <Link
                  to={item.to}
                  className="text-ink-soft transition-colors hover:text-primary-700 dark:text-night-soft dark:hover:text-primary-300"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    last
                      ? "font-medium text-ink dark:text-night-ink"
                      : "text-ink-soft dark:text-night-soft",
                  )}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
