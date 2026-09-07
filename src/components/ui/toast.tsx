import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "info" | "danger";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (t: { tone?: ToastTone; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 在 <ToastProvider> 内调用：push({ tone, title, description }) */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 <ToastProvider> 内使用");
  return ctx;
}

const toneConfig: Record<ToastTone, { icon: typeof Info; color: string }> = {
  success: { icon: CheckCircle2, color: "text-success" },
  info: { icon: Info, color: "text-info" },
  danger: { icon: XCircle, color: "text-danger" },
};

const TOAST_DURATION = 3800;

/** 单个 Toast */
export function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  const { icon: Icon, color } = toneConfig[toast.tone];
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-pop animate-toast-in dark:border-night-line dark:bg-night-surface"
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink dark:text-night-ink">
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft dark:text-night-soft">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭"
        className="rounded p-0.5 text-ink-faint transition-colors hover:text-ink dark:text-night-faint dark:hover:text-night-ink"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** 独立的 Toast 堆栈（也可被 <ToastProvider> 内部使用） */
export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

/**
 * 全局轻提示：在应用根部包一层 <ToastProvider>，
 * 任意组件里 useToast().push(...) 即可弹出。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    ({ tone = "info", title, description }: { tone?: ToastTone; title: string; description?: string }) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-3), { id, tone, title, description }]);
      window.setTimeout(() => dismiss(id), TOAST_DURATION);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
