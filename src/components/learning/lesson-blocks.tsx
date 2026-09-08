import type { LessonBlock } from "@/content/types";
import { cn } from "@/lib/utils";
import { Callout } from "./callout";
import { CodeBlock } from "./code-block";
import { Definition } from "./definition";
import { Exercise } from "./exercise";
import { InlineMd } from "./inline-content";
import { KeyPoints } from "./key-points";
import { Quiz } from "./quiz";
import { VideoEmbed } from "./video-embed";

/* ------------------------------------------------------------------
 * 课时内容块渲染器
 * ----------------------------------------------------------------
 * 把 Lesson.blocks 中的 LessonBlock 数据逐块渲染成组件。
 * - heading / subheading 会生成带 id 的锚点（供目录跳转）
 * - 块之间统一使用 space-y-5 节奏；h2 额外加大上间距（margin 折叠取大值）
 * - 新增块类型时：1) 在 types.ts 扩展联合类型  2) 在这里加分支
 * ================================================================== */

/** 生成稳定锚点 id：中文文本按块序号兜底 */
function slugifyHeading(text: string, fallback: number): string {
  const latin = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || `section-${fallback}`;
}

export function LessonBlocks({
  blocks,
  courseSlug,
  className,
}: {
  blocks: LessonBlock[];
  /** 所属课程 slug：叙事字段据此解析术语引用（悬浮卡片/术语页链接） */
  courseSlug?: string;
  className?: string;
}) {
  let headingCount = 0;

  return (
    <div className={cn("space-y-5", className)}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p
                key={i}
                className="text-[1.02rem] leading-8 text-ink dark:text-night-ink"
              >
                <InlineMd text={block.text} courseSlug={courseSlug} />
              </p>
            );

          case "heading": {
            headingCount += 1;
            const id = slugifyHeading(block.text, headingCount);
            return (
              <h2
                key={i}
                id={id}
                className="mt-6 scroll-mt-24 pt-2 font-display text-[1.5rem] font-semibold leading-snug text-ink dark:text-night-ink"
              >
                {block.text}
              </h2>
            );
          }

          case "subheading": {
            headingCount += 1;
            const id = slugifyHeading(block.text, headingCount);
            return (
              <h3
                key={i}
                id={id}
                className="scroll-mt-24 pt-1 text-[1.125rem] font-semibold leading-snug text-ink dark:text-night-ink"
              >
                {block.text}
              </h3>
            );
          }

          case "list":
            return block.ordered ? (
              <ol
                key={i}
                className="list-decimal space-y-1.5 pl-6 text-[1.02rem] leading-8 text-ink marker:text-primary-600 dark:text-night-ink"
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <InlineMd text={item} courseSlug={courseSlug} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul
                key={i}
                className="list-disc space-y-1.5 pl-6 text-[1.02rem] leading-8 text-ink marker:text-primary-600 dark:text-night-ink"
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <InlineMd text={item} courseSlug={courseSlug} />
                  </li>
                ))}
              </ul>
            );

          case "callout":
            return (
              <Callout
                key={i}
                variant={block.variant}
                title={block.title}
                courseSlug={courseSlug}
              >
                {block.body}
              </Callout>
            );

          case "code":
            return (
              <CodeBlock
                key={i}
                code={block.code}
                language={block.language}
                title={block.title}
              />
            );

          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse overflow-hidden rounded-md border border-line text-sm dark:border-night-line">
                  {block.caption && (
                    <caption className="border-b border-line bg-canvas-2/70 px-4 py-2 text-left text-xs font-medium text-ink-soft dark:border-night-line dark:bg-night-surface-2/70 dark:text-night-soft">
                      {block.caption}
                    </caption>
                  )}
                  <thead>
                    <tr className="bg-canvas-2/80 dark:bg-night-surface-2/80">
                      {block.headers.map((h, j) => (
                        <th
                          key={j}
                          scope="col"
                          className="px-4 py-2.5 text-left font-semibold text-ink dark:text-night-ink"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr
                        key={r}
                        className="border-t border-line dark:border-night-line"
                      >
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className="px-4 py-2.5 leading-relaxed text-ink-soft dark:text-night-soft"
                          >
                            <InlineMd text={cell} courseSlug={courseSlug} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "definition":
            return (
              <Definition
                key={i}
                term={block.term}
                definition={block.definition}
                courseSlug={courseSlug}
              />
            );

          case "keypoints":
            return <KeyPoints key={i} items={block.items} courseSlug={courseSlug} />;

          case "quiz":
            return (
              <Quiz
                key={i}
                question={block.question}
                options={block.options}
                answer={block.answer}
                explanation={block.explanation}
                courseSlug={courseSlug}
              />
            );

          case "exercise":
            return (
              <Exercise
                key={i}
                title={block.title}
                description={block.description}
                hint={block.hint}
                courseSlug={courseSlug}
              />
            );

          case "video":
            return (
              <VideoEmbed
                key={i}
                title={block.title}
                provider={block.provider}
                src={block.src}
                duration={block.duration}
              />
            );

          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-amber-400 py-1 pl-5 font-display text-lg leading-relaxed text-ink-soft italic dark:border-amber-500 dark:text-night-soft"
              >
                <InlineMd text={block.text} courseSlug={courseSlug} />
                {block.source && (
                  <footer className="mt-1.5 text-sm not-italic text-ink-faint dark:text-night-faint">
                    —— {block.source}
                  </footer>
                )}
              </blockquote>
            );

          case "divider":
            return (
              <hr
                key={i}
                className="border-line dark:border-night-line"
              />
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

/** 提取课时内的标题块，供目录（TableOfContents）使用 */
export function collectToc(blocks: LessonBlock[]) {
  const entries: { id: string; text: string; level: 2 | 3 }[] = [];
  let count = 0;
  blocks.forEach((b) => {
    if (b.type === "heading" || b.type === "subheading") {
      count += 1;
      entries.push({
        id: slugifyHeading(b.text, count),
        text: b.text,
        level: b.type === "heading" ? 2 : 3,
      });
    }
  });
  return entries;
}
