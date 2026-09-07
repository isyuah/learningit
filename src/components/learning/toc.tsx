import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * 课时目录（滚动监听）：监听页面中 id 对应的标题元素，
 * 高亮当前阅读位置；点击平滑滚动到对应小节。
 */
export function TableOfContents({
  entries,
  className,
}: {
  entries: TocEntry[];
  className?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;
    const observer = new IntersectionObserver(
      (intersections) => {
        const visible = intersections
          .filter((i) => i.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    entries.forEach((e) => {
      const el = document.getElementById(e.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [entries]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  if (entries.length === 0) return null;

  return (
    <nav aria-label="本课目录" className={cn("text-sm", className)}>
      <p className="mb-2.5 text-xs font-semibold tracking-wider text-ink-faint uppercase dark:text-night-faint">
        本课目录
      </p>
      <ul className="space-y-0.5 border-l border-line dark:border-night-line">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => scrollTo(entry.id)}
              className={cn(
                "-ml-px block w-full border-l-2 py-1 pl-3.5 text-left leading-snug transition-colors",
                entry.level === 3 ? "pl-6 text-[0.8125rem]" : "",
                activeId === entry.id
                  ? "border-primary-600 font-medium text-primary-800 dark:border-primary-400 dark:text-primary-200"
                  : "border-transparent text-ink-soft hover:text-ink dark:text-night-soft dark:hover:text-night-ink",
              )}
            >
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
