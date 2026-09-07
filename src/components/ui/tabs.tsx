import {
  useCallback,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: ReactNode;
  content: ReactNode;
}

/**
 * 标签页：支持方向键切换（左右箭头）。
 */
export function Tabs({
  tabs,
  defaultValue,
  className,
}: {
  tabs: TabItem[];
  defaultValue?: string;
  className?: string;
}) {
  const [active, setActive] = useState(
    defaultValue ?? tabs[0]?.key ?? "",
  );
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const activeIndex = tabs.findIndex((t) => t.key === active);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next =
        (activeIndex + dir + tabs.length) % tabs.length;
      setActive(tabs[next].key);
      const el = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-tabkey="${tabs[next].key}"]`,
      );
      el?.focus();
    },
    [activeIndex, tabs],
  );

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label="标签页"
        onKeyDown={onKeyDown}
        className="flex gap-1 border-b border-line dark:border-night-line"
      >
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              role="tab"
              data-tabkey={tab.key}
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300"
                  : "border-transparent text-ink-soft hover:text-ink dark:text-night-soft dark:hover:text-night-ink",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active}`}
        aria-labelledby={`${baseId}-tab-${active}`}
        className="pt-4"
      >
        {tabs.find((t) => t.key === active)?.content}
      </div>
    </div>
  );
}
