import { useState } from "react";
import { CheckCircle2, HelpCircle, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 交互式测验：选择题 + 即时反馈 + 讲解。
 * 答题后才展示讲解，避免「先看到答案」。
 */
export function Quiz({
  question,
  options,
  answer,
  explanation,
  className,
}: {
  question: string;
  options: string[];
  /** 正确答案下标（0 起） */
  answer: number;
  explanation: string;
  className?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setSelected(null);
    setSubmitted(false);
  };

  const isCorrect = selected === answer;

  return (
    <section
      aria-label="测验"
      className={cn(
        "overflow-hidden rounded-md border border-line bg-surface shadow-card",
        "dark:border-night-line dark:bg-night-surface",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-line bg-canvas-2/60 px-5 py-3 dark:border-night-line dark:bg-night-surface-2/60">
        <HelpCircle aria-hidden className="size-4.5 text-primary-700 dark:text-primary-300" />
        <h4 className="text-sm font-semibold text-ink dark:text-night-ink">
          小测验
        </h4>
      </header>
      <div className="px-5 py-4">
        <p className="mb-4 font-medium leading-relaxed text-ink dark:text-night-ink">
          {question}
        </p>
        <div role="radiogroup" aria-label="选项" className="space-y-2.5">
          {options.map((opt, i) => {
            const isSelected = selected === i;
            const showState = submitted && (isSelected || i === answer);
            const isAnswer = submitted && i === answer;
            const letter = String.fromCharCode(65 + i);
            return (
              <label
                key={i}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed transition-all duration-150",
                  "border-line bg-surface dark:border-night-line dark:bg-night-surface",
                  !submitted && "hover:border-primary-300 hover:bg-primary-50/60 hover:shadow-card dark:hover:border-primary-600 dark:hover:bg-primary-900/20",
                  isSelected && !submitted &&
                    "border-primary-500 bg-primary-100/70 ring-1 ring-primary-500/30 dark:border-primary-500 dark:bg-primary-900/40",
                  showState && isAnswer &&
                    "border-success bg-success-soft dark:border-success/60 dark:bg-success/15",
                  showState && !isAnswer &&
                    "border-danger bg-danger-soft dark:border-danger/60 dark:bg-danger/15",
                )}
              >
                <input
                  type="radio"
                  name={`quiz-${question.slice(0, 12)}`}
                  className="sr-only"
                  checked={isSelected}
                  disabled={submitted}
                  onChange={() => setSelected(i)}
                />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border font-semibold text-xs transition-colors",
                    "border-line-strong bg-canvas-2 text-ink-soft dark:border-night-line-strong dark:bg-night-surface-2 dark:text-night-soft",
                    isSelected && !submitted &&
                      "border-primary-600 bg-primary-600 text-white dark:border-primary-500 dark:bg-primary-500",
                    showState && isAnswer && "border-success bg-success text-white",
                    showState && !isAnswer && "border-danger bg-danger text-white",
                  )}
                >
                  {showState && isAnswer ? (
                    <CheckCircle2 className="size-4" />
                  ) : showState && !isAnswer ? (
                    <XCircle className="size-4" />
                  ) : (
                    letter
                  )}
                </span>
                <span className="text-ink dark:text-night-ink">{opt}</span>
              </label>
            );
          })}
        </div>

        {!submitted ? (
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={selected === null}
            className="mt-4 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-primary-600 dark:hover:bg-primary-500"
          >
            提交答案
          </button>
        ) : (
          <div
            className={cn(
              "mt-4 rounded-md border px-4 py-3",
              isCorrect
                ? "border-success/40 bg-success-soft dark:border-success/40 dark:bg-success/10"
                : "border-danger/40 bg-danger-soft dark:border-danger/40 dark:bg-danger/10",
            )}
          >
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm font-semibold",
                isCorrect ? "text-success dark:text-[#86D6A7]" : "text-danger dark:text-[#E49A8C]",
              )}
            >
              {isCorrect ? (
                <>
                  <CheckCircle2 aria-hidden className="size-4" /> 回答正确
                </>
              ) : (
                <>
                  <XCircle aria-hidden className="size-4" />
                  回答错误，正确答案是第 {answer + 1} 项
                </>
              )}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft dark:text-night-soft">
              {explanation}
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-2.5 inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-200"
            >
              <RotateCcw aria-hidden className="size-3.5" /> 重新作答
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
