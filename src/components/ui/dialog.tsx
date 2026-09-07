import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 对话框（模态）：支持 ESC 关闭、点击遮罩关闭、焦点圈定、滚动锁定。
 * 用法：
 *   <Dialog open={open} onClose={() => setOpen(false)} title="标题">
 *     …内容…
 *   </Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    // 焦点圈定：简单实现 —— 打开时聚焦面板，关闭时还原
    const t = window.setTimeout(() => panelRef.current?.focus(), 10);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px] animate-fade-in dark:bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative flex w-full max-w-lg flex-col rounded-xl border border-line bg-surface shadow-pop outline-none animate-scale-in",
          "dark:border-night-line dark:bg-night-surface",
          "max-h-[85vh]",
          className,
        )}
      >
        {/* 标题栏固定：内容滚动时不会滚走（关闭按钮始终可见） */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 dark:border-night-line dark:bg-night-surface">
          <div>
            <h2 className="text-base font-semibold text-ink dark:text-night-ink">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-sm text-ink-soft dark:text-night-soft">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-canvas-2 hover:text-ink dark:text-night-faint dark:hover:bg-night-surface-2 dark:hover:text-night-ink"
          >
            <X className="size-4.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line bg-surface px-5 py-3.5 dark:border-night-line dark:bg-night-surface">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
