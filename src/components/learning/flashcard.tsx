import { useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 翻转记忆卡（Flashcard）：点击翻面，正面提问、背面答案。
 * 适合术语、概念速记；可组合进课时内容用于复习。
 */
export function Flashcard({
  front,
  back,
  className,
}: {
  front: ReactNode;
  back: ReactNode;
  className?: string;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className={cn("[perspective:1200px]", className)}>
      <button
        type="button"
        onClick={() => setFlipped((v) => !v)}
        aria-pressed={flipped}
        aria-label={flipped ? "翻转回正面" : "翻转查看答案"}
        className="relative block w-full text-left outline-offset-4 [transform-style:preserve-3d] transition-transform duration-500 motion-reduce:transition-none"
        style={{ transform: flipped ? "rotateY(180deg)" : undefined }}
      >
        {/* 正面 */}
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface px-6 py-8 text-center shadow-card [backface-visibility:hidden] dark:border-night-line dark:bg-night-surface">
          <span className="text-xs text-ink-faint dark:text-night-faint">正面 · 问题</span>
          <span className="text-base font-medium text-ink dark:text-night-ink">{front}</span>
        </div>
        {/* 背面 */}
        <div
          aria-hidden={!flipped}
          className="absolute inset-0 flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-6 py-8 text-center shadow-card [backface-visibility:hidden] [transform:rotateY(180deg)] dark:border-primary-800 dark:bg-primary-900/30"
        >
          <span className="text-xs text-ink-faint dark:text-night-faint">背面 · 答案</span>
          <span className="text-base text-ink dark:text-night-ink">{back}</span>
        </div>
      </button>
      <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-ink-faint dark:text-night-faint">
        <RotateCw aria-hidden className="size-3.5" />
        点击卡片翻面查看答案
      </p>
    </div>
  );
}
