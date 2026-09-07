import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

const DROPDOWN_MAX_HEIGHT = 260;

/**
 * 自研下拉选择器（非原生 select）：
 * - 完全自绘：触发器 + 弹层列表，视觉与 Input 一致
 * - 键盘可达：Enter/空格 打开，↑↓ 移动，Enter 选择，Esc 关闭，Home/End 跳转
 * - 弹层通过 Portal 渲染到 body：自动避让视口（下方空间不足时向上展开）、
 *   页面滚动/缩放时自动关闭；高亮项滚动仅作用于弹层内部，不会带动页面
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "请选择…",
  error,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    openAbove: boolean;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const selected = options.find((o) => o.value === value);
  const activeIndex = options.findIndex((o) => o.value === value);

  /* 打开：测量触发器位置（弹层 fixed 定位到 body，自动避让视口） */
  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow;
      setPos({
        top: openAbove ? rect.top - 6 : rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - rect.width - 8),
        width: rect.width,
        openAbove,
      });
      setHighlighted(activeIndex >= 0 ? activeIndex : 0);
    }
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, activeIndex]);

  /* 高亮项在弹层内部滚动到可见（只滚容器，不滚窗口） */
  useEffect(() => {
    if (!open || !pos) return;
    const container = listRef.current;
    const opt = container?.querySelector<HTMLElement>(`[data-idx="${highlighted}"]`);
    if (!container || !opt) return;
    if (opt.offsetTop < container.scrollTop) {
      container.scrollTop = opt.offsetTop;
    } else if (
      opt.offsetTop + opt.offsetHeight >
      container.scrollTop + container.clientHeight
    ) {
      container.scrollTop =
        opt.offsetTop - container.clientHeight + opt.offsetHeight;
    }
  }, [highlighted, open, pos]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const opt = options[highlighted];
        if (opt) choose(opt.value);
        break;
      }
      case "Home":
        e.preventDefault();
        setHighlighted(0);
        break;
      case "End":
        e.preventDefault();
        setHighlighted(options.length - 1);
        break;
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        ref={triggerRef}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${baseId}-listbox`}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 text-sm",
          "transition-colors duration-150",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:bg-night-surface dark:text-night-ink",
          error
            ? "border-danger focus:border-danger focus:ring-danger/25 dark:border-danger"
            : cn(
                "border-line-strong dark:border-night-line-strong",
                open
                  ? "border-primary-500 ring-2 ring-primary-500/25 dark:border-primary-500"
                  : "hover:border-primary-400 dark:hover:border-primary-500",
              ),
        )}
      >
        <span
          className={cn(
            "truncate text-left",
            selected
              ? "text-ink dark:text-night-ink"
              : "text-ink-faint dark:text-night-faint",
          )}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-ink-faint transition-transform duration-150 dark:text-night-faint",
            open && "rotate-180",
          )}
        />
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={listRef}
            id={`${baseId}-listbox`}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-50 max-h-64 min-w-40 overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-pop dark:border-night-line dark:bg-night-surface"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              transform: pos.openAbove ? "translateY(-100%)" : undefined,
            }}
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isHighlighted = i === highlighted;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  data-idx={i}
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => choose(opt.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                    isHighlighted
                      ? "bg-canvas-2 text-ink dark:bg-night-surface-2 dark:text-night-ink"
                      : "text-ink-soft dark:text-night-soft",
                    isSelected && "font-medium text-primary-700 dark:text-primary-300",
                  )}
                >
                  {opt.label}
                  {isSelected && (
                    <Check aria-hidden className="size-4 shrink-0 text-primary-600 dark:text-primary-400" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
