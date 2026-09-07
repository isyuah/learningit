import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { CornerDownLeft, FileText, GraduationCap, Search } from "lucide-react";
import { courses, flattenLessons } from "@/content/courses";
import { cn } from "@/lib/utils";

interface CmdItem {
  id: string;
  kind: "课程" | "课时" | "页面";
  label: string;
  hint: string;
  to: string;
}

const MAX_RESULTS = 12;

/**
 * 命令面板（Cmd+K 站内搜索）：
 * - 快捷键 Ctrl/Cmd + K 唤起；页头搜索按钮同样可用
 * - 搜索课程、课时与页面；↑↓ 选择、Enter 跳转、Esc 关闭
 * - 索引来自 src/content/courses/（约定式加载），内容更新后自动生效
 */
export function CommandMenu({ className }: { className?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* 索引：课程 + 课时 + 页面 */
  const items = useMemo<CmdItem[]>(() => {
    const out: CmdItem[] = [];
    for (const c of courses) {
      out.push({
        id: `course-${c.slug}`,
        kind: "课程",
        label: c.title,
        hint: c.tagline,
        to: `/courses/${c.slug}`,
      });
      for (const l of flattenLessons(c)) {
        if (l.meta.locked) continue;
        out.push({
          id: `lesson-${c.slug}-${l.meta.slug}`,
          kind: "课时",
          label: l.meta.title,
          hint: `${c.title} · ${l.meta.minutes} 分钟`,
          to: `/courses/${c.slug}/lessons/${l.meta.slug}`,
        });
      }
    }
    out.push({ id: "page-components", kind: "页面", label: "组件库", hint: "设计系统与组件演示", to: "/components" });
    out.push({ id: "page-guide", kind: "页面", label: "使用指南", hint: "如何填充内容与部署", to: "/guide" });
    return out;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items.filter((i) => i.kind === "页面").slice(0, MAX_RESULTS);
    }
    return items
      .filter(
        (i) =>
          i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q),
      )
      .slice(0, MAX_RESULTS);
  }, [query, items]);

  /* 全局快捷键 Ctrl/Cmd+K */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* 打开时聚焦输入框并重置；路由变化时关闭 */
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [open]);
  useEffect(() => setOpen(false), [location.pathname]);

  /* 高亮项滚动到可见（只滚容器） */
  useEffect(() => {
    if (!open) return;
    const container = listRef.current;
    const opt = container?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    if (!container || !opt) return;
    if (opt.offsetTop < container.scrollTop) container.scrollTop = opt.offsetTop;
    else if (opt.offsetTop + opt.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = opt.offsetTop - container.clientHeight + opt.offsetHeight;
    }
  }, [active, open]);

  const go = (item: CmdItem) => {
    setOpen(false);
    navigate(item.to);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const item = filtered[active];
        if (item) go(item);
        break;
      }
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="搜索（Ctrl+K）"
        className={cn(
          "rounded-md p-2.5 text-ink-soft transition-colors hover:bg-canvas-2 hover:text-ink",
          "dark:text-night-soft dark:hover:bg-night-surface-2 dark:hover:text-night-ink",
          className,
        )}
      >
        <Search aria-hidden className="size-5" />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
            role="dialog"
            aria-modal="true"
            aria-label="站内搜索"
          >
            <div
              className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-in dark:bg-black/60"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-scale-in dark:border-night-line dark:bg-night-surface">
              <div className="flex items-center gap-2.5 border-b border-line px-4 dark:border-night-line">
                <Search aria-hidden className="size-4.5 shrink-0 text-ink-faint dark:text-night-faint" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onInputKeyDown}
                  placeholder="搜索课程、课时…"
                  aria-label="搜索关键词"
                  className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint dark:text-night-ink dark:placeholder:text-night-faint"
                />
              </div>

              <div ref={listRef} role="listbox" aria-label="搜索结果" className="max-h-80 overflow-y-auto p-1.5">
                {filtered.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-ink-faint dark:text-night-faint">
                    没有匹配「{query}」的结果
                  </p>
                )}
                {filtered.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    data-idx={i}
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                      i === active
                        ? "bg-canvas-2 dark:bg-night-surface-2"
                        : "bg-transparent",
                    )}
                  >
                    {item.kind === "课程" ? (
                      <GraduationCap aria-hidden className="size-4 shrink-0 text-primary-600 dark:text-primary-400" />
                    ) : item.kind === "课时" ? (
                      <FileText aria-hidden className="size-4 shrink-0 text-ink-faint dark:text-night-faint" />
                    ) : (
                      <CornerDownLeft aria-hidden className="size-4 shrink-0 text-ink-faint dark:text-night-faint" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", i === active ? "text-ink dark:text-night-ink" : "text-ink-soft dark:text-night-soft")}>
                        {item.label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-faint dark:text-night-faint">
                        {item.hint}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium",
                        item.kind === "课程"
                          ? "bg-primary-100 text-primary-800 dark:bg-primary-900/60 dark:text-primary-200"
                          : "bg-canvas-2 text-ink-faint dark:bg-night-surface-2 dark:text-night-faint",
                      )}
                    >
                      {item.kind}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[0.6875rem] text-ink-faint dark:border-night-line dark:text-night-faint">
                <span><kbd className="font-mono">↑↓</kbd> 选择</span>
                <span><kbd className="font-mono">↵</kbd> 打开</span>
                <span><kbd className="font-mono">esc</kbd> 关闭</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
