import { cn } from "@/lib/utils";

const toneClasses = [
  "bg-primary-100 text-primary-800 dark:bg-primary-900/60 dark:text-primary-200",
  "bg-amber-100 text-amber-600 dark:bg-amber-600/20 dark:text-amber-300",
  "bg-info-soft text-info dark:bg-info/20 dark:text-[#8fb9d6]",
  "bg-success-soft text-success dark:bg-success/20 dark:text-[#86D6A7]",
  "bg-danger-soft text-danger dark:bg-danger/20 dark:text-[#E49A8C]",
] as const;

const sizeClasses = {
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-12 text-lg",
} as const;

/** 按名字取首字做确定性配色（老师/助教等无头像场景） */
function hashName(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/**
 * 首字头像：无图片素材时的轻量方案。
 * 传入姓名，自动取首字并从主题色板选一个确定性的底色。
 */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initial = Array.from(name.trim())[0] ?? "?";
  const tone = toneClasses[hashName(name) % toneClasses.length];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        tone,
        sizeClasses[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}
