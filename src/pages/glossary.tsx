import { useMemo } from "react";
import { BookMarked } from "lucide-react";
import { flattenLessons, getCourse, getGlossary, getLesson } from "@/content/courses";
import type { GlossaryEntry } from "@/content/types";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LessonBlocks } from "@/components/learning/lesson-blocks";
import { collectGlossaryKeys, walkLessonBlockMd } from "@/lib/inline-markdown";

interface EntryRow {
  entry: GlossaryEntry;
  /** 首次被正文引用的位置（大纲拍平序号）；未引用词条无此字段 */
  first?: { at: number; meta: { slug: string; title: string }; chapterTitle: string };
}

function orderEntries(courseSlug: string, glossary: GlossaryEntry[]): EntryRow[] {
  const course = getCourse(courseSlug);
  if (!course) return glossary.map((entry) => ({ entry }));

  // 按大纲顺序扫全部课时正文，记录每个 key 的首次引用位置
  const firstSeen = new Map<string, { at: number; meta: { slug: string; title: string }; chapterTitle: string }>();
  let at = 0;
  for (const item of flattenLessons(course)) {
    const lesson = getLesson(item.meta.slug);
    if (lesson) {
      for (const block of lesson.blocks) {
        walkLessonBlockMd(block, (_field, value) => {
          for (const key of collectGlossaryKeys(value)) {
            if (!firstSeen.has(key)) {
              firstSeen.set(key, {
                at,
                meta: { slug: item.meta.slug, title: item.meta.title },
                chapterTitle: item.chapterTitle,
              });
            }
          }
        });
      }
    }
    at += 1;
  }

  // 已引用词条按首次出现排序，未引用词条按词条表原顺序跟在后面
  return glossary
    .map((entry): EntryRow => ({ entry, first: firstSeen.get(entry.key) }))
    .sort((a, b) => {
      if (a.first && b.first) return a.first.at - b.first.at;
      if (a.first) return -1;
      if (b.first) return 1;
      return 0;
    });
}

/** 术语表：课程级共享概念速查页，词条按首次被正文引用顺序排列 */
export function GlossaryPage({ courseSlug }: { courseSlug: string }) {
  const course = getCourse(courseSlug);
  const glossary = getGlossary(courseSlug);

  const rows = useMemo(
    () => (course && glossary ? orderEntries(courseSlug, glossary) : []),
    [course, glossary, courseSlug],
  );

  if (!course) {
    return (
      <div className="wrap py-24">
        <EmptyState
          title="课程不存在"
          description={`没有找到 slug 为「${courseSlug}」的课程。`}
          action={
            <LinkButton to="/#courses" variant="secondary">
              返回课程总览
            </LinkButton>
          }
        />
      </div>
    );
  }

  if (!glossary || glossary.length === 0) {
    return (
      <div className="wrap py-24">
        <EmptyState
          icon={<BookMarked />}
          title="本课程还没有术语表"
          description={
            <>
              在课程目录新建{" "}
              <code className="rounded bg-canvas-2 px-1 py-0.5 font-mono text-[0.85em] dark:bg-night-surface-2">
                glossary.ts
              </code>
              导出 <code className="rounded bg-canvas-2 px-1 py-0.5 font-mono text-[0.85em] dark:bg-night-surface-2">glossary</code>{" "}
              词条数组；正文里用{" "}
              <code className="rounded bg-canvas-2 px-1 py-0.5 font-mono text-[0.85em] dark:bg-night-surface-2">
                [文字](glossary:key)
              </code>{" "}
              引用即可。
            </>
          }
          action={
            <LinkButton to={`/courses/${course.slug}`} variant="secondary">
              返回课程大纲
            </LinkButton>
          }
        />
      </div>
    );
  }

  return (
    <div className="wrap pb-24 pt-8">
      <Breadcrumbs
        items={[
          { label: "首页", to: "/" },
          { label: "课程", to: "/#courses" },
          { label: course.title, to: `/courses/${course.slug}` },
          { label: "术语表" },
        ]}
      />

      {/* 页头 */}
      <header className="mt-6 border-b border-line pb-6 dark:border-night-line">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="amber">术语表</Badge>
          <Badge tone="neutral">{glossary.length} 条</Badge>
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-snug text-ink sm:text-4xl dark:text-night-ink">
          {course.title} · 课程术语
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-ink-soft dark:text-night-soft">
          整门课程共享的概念速查：正文中带虚线标注的词均可悬浮看简介、点击直达对应词条。
          词条按首次出现在正文中的顺序排列，适合复习与查漏。
        </p>
      </header>

      {/* 全部词条快捷导航 */}
      <nav aria-label="词条导航" className="mt-6 flex flex-wrap gap-2">
        {rows.map(({ entry }) => (
          <a
            key={entry.key}
            href={`#${entry.key}`}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-primary-300 hover:text-primary-800 hover:shadow-card dark:border-night-line dark:bg-night-surface dark:text-night-soft dark:hover:border-primary-700 dark:hover:text-primary-200"
          >
            {entry.term}
          </a>
        ))}
      </nav>

      {/* 词条列表 */}
      <div className="mt-8 space-y-8">
        {rows.map(({ entry, first }) => (
          <section
            key={entry.key}
            id={entry.key}
            aria-label={entry.term}
            className="scroll-mt-24 border-b border-line pb-8 last:border-b-0 dark:border-night-line"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-xl font-semibold text-ink dark:text-night-ink">
                {entry.term}
              </h2>
              <code className="rounded bg-canvas-2 px-1.5 py-0.5 font-mono text-[0.75rem] text-ink-faint dark:bg-night-surface-2 dark:text-night-faint">
                glossary:{entry.key}
              </code>
            </div>
            <p className="mt-2 max-w-3xl leading-relaxed text-ink-soft dark:text-night-soft">
              {entry.summary}
            </p>
            {first && (
              <p className="mt-2 text-xs text-ink-faint dark:text-night-faint">
                首次出现于{" "}
                <span className="text-ink-soft dark:text-night-soft">{first.chapterTitle}</span>
                {" · "}
                <a
                  href={`/courses/${course.slug}/lessons/${first.meta.slug}`}
                  className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-4 transition-colors hover:text-primary-900 dark:text-primary-300 dark:decoration-primary-600/60 dark:hover:text-primary-200"
                >
                  第 {first.at + 1} 节 · {first.meta.title}
                </a>
              </p>
            )}
            {entry.detail && entry.detail.length > 0 && (
              <div className="mt-4 max-w-3xl">
                <LessonBlocks blocks={entry.detail} courseSlug={course.slug} />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
