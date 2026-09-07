import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export { Select } from "./select";
export type { SelectOption } from "./select";

/* ------------------------------------------------------------------
 * Field：标签 + 控件 + 提示/错误 的组合容器
 * ------------------------------------------------------------------ */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="text-sm font-medium text-ink dark:text-night-ink"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-faint dark:text-night-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
 * 基础控件样式
 * ------------------------------------------------------------------ */
const controlBase = [
  "w-full rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint",
  "transition-colors duration-150",
  "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "dark:bg-night-surface dark:text-night-ink dark:placeholder:text-night-faint",
  "dark:focus:ring-primary-400/25",
].join(" ");

const controlBorder =
  "border-line-strong dark:border-night-line-strong";

const controlError =
  "border-danger focus:border-danger focus:ring-danger/25 dark:border-danger";

function borderClass(error?: string) {
  return error ? controlError : controlBorder;
}

/* ------------------------------------------------------------------ */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { error?: boolean }
>(({ className, error, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(controlBase, borderClass(error ? "x" : undefined), "h-10", className)}
    aria-invalid={error || undefined}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }
>(({ className, error, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlBase, borderClass(error ? "x" : undefined), "min-h-24 py-2 leading-relaxed", className)}
    aria-invalid={error || undefined}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/* ------------------------------------------------------------------
 * Checkbox / Radio / Switch
 * ------------------------------------------------------------------ */
export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 text-sm text-ink select-none dark:text-night-ink",
        className,
      )}
    >
      <input
        type="checkbox"
        className="size-4 rounded border-line-strong bg-surface accent-primary-600 dark:border-night-line-strong dark:bg-night-surface"
        {...props}
      />
      {label}
    </label>
  );
}

export function Radio({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 text-sm text-ink select-none dark:text-night-ink",
        className,
      )}
    >
      <input
        type="radio"
        className="size-4 border-line-strong bg-surface accent-primary-600 dark:border-night-line-strong dark:bg-night-surface"
        {...props}
      />
      {label}
    </label>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  className,
}: {
  label?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 text-sm text-ink select-none dark:text-night-ink",
        className,
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors duration-200",
          checked
            ? "bg-primary-600 dark:bg-primary-500"
            : "bg-line-strong dark:bg-night-line-strong",
        )}
      >
        <span
          className={cn(
            "inline-block size-4.5 transform rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-5" : "translate-x-1",
          )}
        />
      </button>
      {label}
    </label>
  );
}
