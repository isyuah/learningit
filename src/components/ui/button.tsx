import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-card",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-primary-400 hover:text-primary-700 dark:border-night-line-strong dark:bg-night-surface dark:text-night-ink dark:hover:border-primary-500 dark:hover:text-primary-200",
  ghost:
    "text-ink-soft hover:bg-canvas-2 hover:text-ink dark:text-night-soft dark:hover:bg-night-surface-2 dark:hover:text-night-ink",
  soft:
    "bg-primary-100 text-primary-800 hover:bg-primary-200 dark:bg-primary-900 dark:text-primary-200 dark:hover:bg-primary-800",
  danger:
    "bg-danger text-white hover:bg-[#9c3a28] active:bg-[#8a3323]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[0.8125rem] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[0.9375rem] gap-2",
};

/** 按钮样式工厂：供 <Button> 与 <LinkButton> 共用 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium",
    "transition-all duration-150 select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.98]",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载态：显示 spinner 并禁用 */
  loading?: boolean;
  /** 图标（置于文字前） */
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/** 路由链接样式的按钮（渲染 react-router <Link>） */
export function LinkButton({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}
