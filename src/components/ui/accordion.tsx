import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AccordionItem {
  title: ReactNode;
  content: ReactNode;
}

/**
 * 手风琴/折叠面板：默认全部收起；openIndex 受控时由外部控制展开项。
 */
export function Accordion({
  items,
  multiple = false,
  defaultOpen,
  className,
}: {
  items: AccordionItem[];
  /** 是否允许多个同时展开 */
  multiple?: boolean;
  /** 默认展开的项（下标） */
  defaultOpen?: number[];
  className?: string;
}) {
  const [open, setOpen] = useState<Set<number>>(
    new Set(defaultOpen ?? []),
  );

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else {
        if (!multiple) next.clear();
        next.add(i);
      }
      return next;
    });
  };

  return (
    <div
      className={cn(
        "divide-y divide-line rounded-lg border border-line bg-surface",
        "dark:divide-night-line dark:border-night-line dark:bg-night-surface",
        className,
      )}
    >
      {items.map((item, i) => {
        const isOpen = open.has(i);
        return (
          <div key={i}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`acc-panel-${i}`}
              onClick={() => toggle(i)}
              className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left text-sm font-medium text-ink transition-colors hover:text-primary-700 dark:text-night-ink dark:hover:text-primary-300"
            >
              {item.title}
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-4 shrink-0 text-ink-faint transition-transform duration-200 dark:text-night-faint",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            <div
              id={`acc-panel-${i}`}
              role="region"
              hidden={!isOpen}
              className="px-5 pb-4 text-sm leading-relaxed text-ink-soft dark:text-night-soft"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
