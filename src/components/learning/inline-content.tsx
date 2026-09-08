/* ==================================================================
 * 行内 Markdown 渲染 + 术语引用（TermRef）
 * ----------------------------------------------------------------
 * 所有叙事字段（见 lib/inline-markdown.ts 的 MD_FIELDS）经这里渲染：
 *   parseInline → React 元素；文本一律由 React 转义，无 XSS 面。
 *
 * 链接按 href 分类（classifyHref）：
 *   glossary:key  → TermRef：悬浮卡片（summary）+ 课程术语页锚点
 *   /…            → 站内 <Link>（react-router）
 *   http(s)/mailto → 外部链接（新窗口）
 *   其余          → 仅渲染文字（validate 会拦下非白名单 scheme）
 * ================================================================== */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { getGlossary } from "@/content/courses";
import type { GlossaryEntry } from "@/content/types";
import { classifyHref, parseInline } from "@/lib/inline-markdown";
import type { MdInlineNode } from "@/lib/inline-markdown";

/* ---------------- 文本元素样式 ---------------- */

const codeCls =
  "rounded-[0.25em] bg-canvas-2/90 px-[0.35em] py-[0.15em] font-mono text-[0.85em] text-ink dark:bg-night-surface-2 dark:text-night-ink";

const linkCls =
  "font-medium text-primary-700 underline decoration-primary-300 underline-offset-4 transition-colors hover:text-primary-900 hover:decoration-primary-500 dark:text-primary-300 dark:decoration-primary-600/60 dark:hover:text-primary-200 dark:hover:decoration-primary-400";

const termAnchorCls =
  "term-ref cursor-help rounded-[2px] font-medium text-primary-800 decoration-primary-400/80 decoration-dotted underline underline-offset-[3px] transition-colors outline-none hover:bg-primary-50 hover:decoration-primary-600 focus-visible:bg-primary-50 focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:text-primary-300 dark:decoration-primary-500/70 dark:hover:bg-primary-900/30 dark:hover:decoration-primary-400 dark:focus-visible:bg-primary-900/30 dark:focus-visible:ring-primary-500/50";

/* ---------------- 渲染 ---------------- */

function renderNodes(nodes: MdInlineNode[], courseSlug: string | undefined): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "br":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className={codeCls}>
            {node.text}
          </code>
        );
      case "strong":
        return <strong key={i} className="font-semibold">{renderNodes(node.children, courseSlug)}</strong>;
      case "em":
        return <em key={i}>{renderNodes(node.children, courseSlug)}</em>;
      case "del":
        return (
          <del key={i} className="text-ink-faint dark:text-night-faint">
            {renderNodes(node.children, courseSlug)}
          </del>
        );
      case "link": {
        const kind = classifyHref(node.href);
        if (kind === "glossary") {
          return (
            <TermRef
              key={i}
              courseSlug={courseSlug}
              glossaryKey={node.href.slice("glossary:".length)}
            >
              {renderNodes(node.children, courseSlug)}
            </TermRef>
          );
        }
        if (kind === "internal") {
          return (
            <Link key={i} to={node.href} className={linkCls}>
              {node.children.length ? renderNodes(node.children, courseSlug) : node.href}
            </Link>
          );
        }
        if (kind === "external") {
          return (
            <a
              key={i}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className={linkCls}
            >
              {node.children.length ? renderNodes(node.children, courseSlug) : node.href}
            </a>
          );
        }
        // 非白名单 scheme：只渲染文字（validate 会报错拦截，这里兜底不产生链接）
        return <span key={i}>{node.children.length ? renderNodes(node.children, courseSlug) : node.href}</span>;
      }
      default:
        return null;
    }
  });
}

/** 渲染一段行内 Markdown 文本为 React 节点（courseSlug 用于解析术语引用） */
export function InlineMd({ text, courseSlug }: { text: string; courseSlug?: string }) {
  return <>{renderNodes(parseInline(text), courseSlug)}</>;
}

/* ---------------- 术语引用（悬浮卡片 + 跳转） ---------------- */

function TermRef({
  courseSlug,
  glossaryKey,
  children,
}: {
  courseSlug?: string;
  glossaryKey: string;
  children: ReactNode;
}) {
  // 无课程上下文（演示页等）或词条缺失：按纯文本渲染，避免产生坏链
  if (!courseSlug) return <>{children}</>;
  const entry = getGlossary(courseSlug)?.find((e) => e.key === glossaryKey);
  if (!entry) return <>{children}</>;
  return (
    <TermAnchor courseSlug={courseSlug} entry={entry}>
      {children}
    </TermAnchor>
  );
}

function TermAnchor({
  courseSlug,
  entry,
  children,
}: {
  courseSlug: string;
  entry: GlossaryEntry;
  children: ReactNode;
}) {
  // hover 态：鼠标悬停/键盘聚焦展开；pinned 态：点击（含移动端 tap）后固定展开
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const popId = useId();
  const to = `/courses/${courseSlug}/glossary#${entry.key}`;

  const closeSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(false), 140);
  };
  const cancelClose = () => window.clearTimeout(closeTimer.current);

  // 打开后测量卡片尺寸，计算固定定位（下方优先，放不下翻到上方；左右贴边）
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchorRef.current;
    const c = cardRef.current;
    if (!a || !c) return;
    const r = a.getBoundingClientRect();
    const gap = 6;
    const cw = c.offsetWidth;
    const ch = c.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + gap;
    if (top + ch > vh - gap) top = Math.max(gap, r.top - ch - gap);
    const left = Math.min(Math.max(gap, r.left), Math.max(gap, vw - cw - gap));
    setBox({ top, left });
  }, [open]);

  const dismiss = () => {
    cancelClose();
    setPinned(false);
    setHover(false);
  };

  // pinned 期间：点击卡片/锚点以外任意处、滚动页面、窗口缩放 → 关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (anchorRef.current?.contains(t) || cardRef.current?.contains(t)) return;
      setPinned(false);
      setHover(false);
    };
    const onViewportChange = () => {
      setPinned(false);
      setHover(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  return (
    <>
      <Link
        ref={anchorRef}
        to={to}
        className={termAnchorCls}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onMouseEnter={() => {
          cancelClose();
          setHover(true);
        }}
        onMouseLeave={closeSoon}
        onFocus={() => {
          cancelClose();
          setHover(true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeSoon();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") dismiss();
        }}
        onClick={(e) => {
          // 普通点击不跳转：固定/收起简介卡片（进完整条目走卡片内链接；
          // Ctrl/Cmd/中键点击仍按浏览器默认在新标签打开术语页锚点）
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          cancelClose();
          if (pinned) {
            // 收起：必须同时清 hover，否则 open = hover || pinned 恒真
            setPinned(false);
            setHover(false);
          } else {
            setPinned(true);
            setHover(true);
          }
        }}
      >
        {children}
      </Link>

      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={popId}
            role="region"
            aria-label={`${entry.term}：术语简介`}
            className={`fixed z-[70] w-72 rounded-lg border border-line bg-surface p-3.5 text-left shadow-lift dark:border-night-line dark:bg-night-surface ${box ? "" : "invisible"}`}
            style={box ?? { top: 0, left: 0 }}
            onMouseEnter={cancelClose}
            onMouseLeave={closeSoon}
          >
            <p className="text-[0.8125rem] font-semibold text-ink dark:text-night-ink">
              {entry.term}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft dark:text-night-soft">
              {entry.summary}
            </p>
            <Link
              to={to}
              className="mt-2.5 inline-flex items-center gap-0.5 text-xs font-medium text-primary-700 transition-colors hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-200"
            >
              查看完整条目 →
            </Link>
          </div>,
          document.body,
        )}
    </>
  );
}
