import { useEffect, useState } from "react";
import { Check, Copy, TerminalSquare } from "lucide-react";
import { highlightCode } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/**
 * 代码块：深色面板 + 语言标签 + 复制按钮 + 语法高亮。
 * - 高亮引擎：Shiki（shiki/bundle/web），懒加载、离线可用
 * - 不支持的代码语言自动回退为纯文本
 * - 高亮渲染完成后才替换内容，避免布局跳动
 */
export function CodeBlock({
  code,
  language = "text",
  title,
  showLineNumbers = false,
  className,
}: {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{
    html: string;
    highlighted: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    highlightCode(code, language).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const copy = async () => {
    let ok = false;
    // 优先使用异步剪贴板 API
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch {
      /* 降级到 execCommand */
    }
    // 降级方案：临时 textarea + execCommand（旧浏览器 / 非安全上下文）
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const lines = code.replace(/\n$/, "").split("\n");
  const isHighlighted = result?.highlighted === true;

  return (
    <figure
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-night-line-strong bg-[#161A21] shadow-card",
        "dark:border-night-line-strong",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/8 bg-white/[0.03] px-4 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs text-[#9AA3B2]">
          <TerminalSquare aria-hidden className="size-3.5 shrink-0" />
          {title ?? (
            <span className="truncate font-mono">{language}</span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[0.6875rem] text-[#6B7484]">
            {language}
          </span>
          <button
            type="button"
            onClick={copy}
            aria-label="复制代码"
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
              copied
                ? "text-[#7fc49b]"
                : "text-[#9AA3B2] hover:bg-white/10 hover:text-[#E5E9F0]",
            )}
          >
            {copied ? (
              <>
                <Check aria-hidden className="size-3.5" /> 已复制
              </>
            ) : (
              <>
                <Copy aria-hidden className="size-3.5" /> 复制
              </>
            )}
          </button>
        </div>
      </figcaption>

      {/* 高亮渲染（Shiki） */}
      {isHighlighted && result ? (
        <div
          className={cn(
            "flex",
            showLineNumbers && "grid grid-cols-[2.75rem_minmax(0,1fr)]",
          )}
        >
          {showLineNumbers && (
            <div
              aria-hidden
              className="select-none border-r border-white/10 py-3.5 text-right font-mono text-[0.8125rem] leading-relaxed text-[#6B7484]"
            >
              {lines.map((_, i) => (
                <div key={i} className="px-3">
                  {i + 1}
                </div>
              ))}
            </div>
          )}
          <div
            className="min-w-0 overflow-x-auto [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:px-4 [&_pre]:py-3.5 [&_pre]:text-[0.8125rem] [&_pre]:leading-relaxed"
            dangerouslySetInnerHTML={{ __html: result.html }}
          />
        </div>
      ) : (
        /* 加载中 / 回退：纯文本渲染 */
        <div className="overflow-x-auto">
          <pre className="py-3.5 text-[0.8125rem] leading-relaxed text-[#D7DCE4]">
            <code className="font-mono">
              {showLineNumbers
                ? lines.map((line, i) => (
                    <span
                      key={i}
                      className="grid grid-cols-[2.5rem_1fr] gap-3 px-4 odd:bg-white/[0.015]"
                    >
                      <span className="text-right text-[#6B7484] select-none">
                        {i + 1}
                      </span>
                      <span className="whitespace-pre">{line || " "}</span>
                    </span>
                  ))
                : lines.map((line, i) => (
                    <span
                      key={i}
                      className="block whitespace-pre px-4 odd:bg-white/[0.015]"
                    >
                      {line || " "}
                    </span>
                  ))}
            </code>
          </pre>
        </div>
      )}
    </figure>
  );
}
