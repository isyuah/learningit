import type { ReactNode } from "react";
import { FlaskConical, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutVariant = "tip" | "note" | "warning" | "example";

const config: Record<
  CalloutVariant,
  { icon: typeof Info; panel: string; label: string }
> = {
  tip: {
    icon: Lightbulb,
    panel:
      "border-amber-300/60 bg-amber-100/70 dark:border-amber-600/40 dark:bg-amber-600/10",
    label: "小贴士",
  },
  note: {
    icon: Info,
    panel:
      "border-info/25 bg-info-soft/70 dark:border-info/40 dark:bg-info/10",
    label: "补充说明",
  },
  warning: {
    icon: TriangleAlert,
    panel:
      "border-warning/30 bg-warning-soft/80 dark:border-warning/40 dark:bg-warning/10",
    label: "注意",
  },
  example: {
    icon: FlaskConical,
    panel:
      "border-primary-300/60 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/25",
    label: "举例",
  },
};

/**
 * 教学提示框：小贴士 / 补充说明 / 注意 / 举例。
 * 用于在讲解中插入与正文不同的「声音」。
 */
export function Callout({
  variant = "note",
  title,
  children,
  className,
}: {
  variant?: CalloutVariant;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const { icon: Icon, panel, label } = config[variant];
  return (
    <aside
      className={cn(
        "flex gap-3.5 rounded-md border px-4.5 py-3.5 text-[0.9375rem] leading-relaxed",
        panel,
        className,
      )}
    >
      <Icon
        aria-hidden
        className="mt-0.5 size-5 shrink-0 text-ink-soft dark:text-night-soft"
      />
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold tracking-wide text-ink-soft uppercase dark:text-night-soft">
          {title ?? label}
        </p>
        <div className="text-ink dark:text-night-ink">{children}</div>
      </div>
    </aside>
  );
}
