import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  CircleCheck,
  FileText,
  ListTree,
  NotebookPen,
  PlayCircle,
} from "lucide-react";
import { flattenLessons, getCourse, getLesson } from "@/content/courses";
import type { LessonKind } from "@/content/types";
import { LESSON_KIND_LABEL } from "@/content/types";
import { useProgress } from "@/lib/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { LessonList, SidebarCourseCard, SidebarProgress } from "@/components/learning/lesson-list";
import { LessonNav } from "@/components/learning/lesson-nav";
import { LessonBlocks, collectToc } from "@/components/learning/lesson-blocks";
import { TableOfContents } from "@/components/learning/toc";
import { StudyAssistant } from "@/components/learning/study-assistant";
import type { StudySection } from "@/lib/ai-assistant";

const kindIcon: Record<LessonKind, typeof FileText> = {
  reading: FileText,
  video: PlayCircle,
  exercise: NotebookPen,
  quiz: BookOpenText,
};

export function LessonPage({
  courseSlug,
  lessonSlug,
}: {
  courseSlug: string;
  lessonSlug: string;
}) {
  const course = getCourse(courseSlug);
  const lesson = getLesson(lessonSlug);
  const { completed, toggle } = useProgress();
  const [tocOpen, setTocOpen] = useState(false);
  const [currentSection, setCurrentSection] = useState<StudySection | null>(null);

  if (!course) {
    return (
      <div className="wrap py-24">
        <EmptyState
          title="课程不存在"
          description={`没有找到课程「${courseSlug}」。请检查 src/content/courses/<course-slug>/course.ts。`}
          action={
            <Link to="/#courses" className="text-sm font-medium text-primary-700 hover:text-primary-900 dark:text-primary-300">
              返回课程总览 →
            </Link>
          }
        />
      </div>
    );
  }

  const flat = flattenLessons(course);
  const meta = flat.find((l) => l.meta.slug === lessonSlug)?.meta;
  const doneCount = flat.filter((l) => completed.has(l.meta.slug)).length;
  const isCompleted = completed.has(lessonSlug);
  const tocEntries = useMemo(
    () => (lesson ? collectToc(lesson.blocks) : []),
    [lesson],
  );

  const missingContent = !!meta && !lesson;
  const locked = !!meta?.locked;

  useEffect(() => {
    setCurrentSection(null);
    if (tocEntries.length === 0) return;

    const updateCurrentSection = () => {
      const threshold = 150;
      let active: StudySection | null = null;
      for (const entry of tocEntries) {
        const element = document.getElementById(entry.id);
        if (element && element.getBoundingClientRect().top <= threshold) {
          active = entry;
        }
      }
      setCurrentSection(active ?? tocEntries[0]);
    };

    updateCurrentSection();
    window.addEventListener("scroll", updateCurrentSection, { passive: true });
    window.addEventListener("resize", updateCurrentSection);
    return () => {
      window.removeEventListener("scroll", updateCurrentSection);
      window.removeEventListener("resize", updateCurrentSection);
    };
  }, [lessonSlug, tocEntries]);

  /* ---------------- 侧边栏（课程目录） ---------------- */
  const sidebar = (
    <nav aria-label="课程目录" className="flex h-full min-h-0 flex-col">
      <SidebarCourseCard course={course} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <LessonList
          course={course}
          activeSlug={lessonSlug}
          completed={completed}
        />
      </div>
      <SidebarProgress done={doneCount} total={flat.length} />
    </nav>
  );

  return (
    <div className="wrap pb-28 pt-6 lg:pb-20">
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_13rem]">
        {/* 桌面侧边栏 */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 h-[calc(100vh-6rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-card dark:border-night-line dark:bg-night-surface">
            {sidebar}
          </div>
        </aside>

        {/* 正文 */}
        <article className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Breadcrumbs
              items={[
                { label: "课程", to: "/#courses" },
                { label: course.title, to: `/courses/${course.slug}` },
                { label: meta?.title ?? lessonSlug },
              ]}
            />
          </div>

          {/* 课时头部 */}
          <header className="mt-6 border-b border-line pb-6 dark:border-night-line">
            <div className="flex flex-wrap items-center gap-2">
              {meta ? (
                <>
                  <Badge tone={meta.kind === "quiz" ? "amber" : meta.kind === "exercise" ? "info" : "primary"}>
                    {LESSON_KIND_LABEL[meta.kind]}
                  </Badge>
                  {isCompleted && <Badge tone="success" dot>已完成</Badge>}
                </>
              ) : (
                <Badge tone="danger">未收录</Badge>
              )}
            </div>
            <h1 className="mt-3 font-display text-[1.75rem] font-semibold leading-snug text-ink sm:text-3xl dark:text-night-ink">
              {meta?.title ?? lessonSlug}
            </h1>
            {meta && (
              <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-faint dark:text-night-faint">
                <span className="inline-flex items-center gap-1.5">
                  <PlayCircle aria-hidden className="size-4" />
                  {meta.minutes} 分钟
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {(() => {
                    const Icon = kindIcon[meta.kind];
                    return <Icon aria-hidden className="size-4" />;
                  })()}
                  第 {flat.findIndex((l) => l.meta.slug === lessonSlug) + 1} 节 / 共 {flat.length} 节
                </span>
              </p>
            )}
            {lesson?.summary && (
              <p className="mt-3 max-w-2xl leading-relaxed text-ink-soft dark:text-night-soft">
                {lesson.summary}
              </p>
            )}
          </header>

          {/* 正文内容 */}
          <div className="mt-8 space-y-6">
            {locked ? (
              <EmptyState
                icon={<LockIcon />}
                title="该课时尚未解锁"
                description="示例数据中把它标记为 locked。解锁方式：在对应课程的 course.ts 中删除该 LessonMeta 的 locked 字段。"
              />
            ) : missingContent ? (
              <EmptyState
                title="这是一节示例占位课时"
                description={
                  <>
                    大纲中有这节「{meta!.title}」，但对应课程的 lessons/ 目录中还没有它的完整课时文件。
                    参考{" "}
                    <Link to="/guide#content-model" className="link">
                      使用指南 · 内容模型
                    </Link>
                    ，按 blocks 语法补上即可。
                  </>
                }
                action={
                  <Link to={`/courses/${course.slug}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:text-primary-900 dark:text-primary-300">
                    <ArrowLeft aria-hidden className="size-4" /> 返回课程大纲
                  </Link>
                }
              />
            ) : lesson ? (
              <>
                <LessonBlocks blocks={lesson.blocks} courseSlug={course.slug} />

                {/* 标记完成 */}
                <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface px-5 py-4 dark:border-night-line dark:bg-night-surface">
                  <p className="text-sm text-ink-soft dark:text-night-soft">
                    学完这一节了吗？标记完成后进度会自动记录。
                  </p>
                  <Button
                    variant={isCompleted ? "soft" : "primary"}
                    icon={
                      isCompleted ? (
                        <CircleCheck aria-hidden className="size-4.5" />
                      ) : (
                        <CheckCircle2 aria-hidden className="size-4.5" />
                      )
                    }
                    onClick={() => toggle(lessonSlug)}
                    className="shrink-0"
                  >
                    {isCompleted ? "已完成" : "标记为已完成"}
                  </Button>
                </div>
              </>
            ) : null}

            <LessonNav course={course} currentSlug={lessonSlug} />
          </div>
        </article>

        {/* 右侧目录 */}
        <aside className="hidden xl:block">
          <div className="sticky top-20">
            <TableOfContents entries={tocEntries} />
          </div>
        </aside>
      </div>

      {/* 移动端目录抽屉（底部弹出；标题栏固定，仅内容区滚动） */}
      <Dialog
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        title="课程目录"
        description={course.title}
      >
        {/* 确定高度容器：让大纲列表独立滚动，课程头与进度条不跟着滚走 */}
        <div className="h-[52vh] overflow-hidden rounded-md border border-line dark:border-night-line">
          {sidebar}
        </div>
        {tocEntries.length > 0 && (
          <div className="mt-5 border-t border-line pt-4 dark:border-night-line">
            <TableOfContents entries={tocEntries} />
          </div>
        )}
      </Dialog>

      {/* 移动端常驻底部条：滚动阅读时大纲入口与进度始终可见 */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur-md lg:hidden [padding-bottom:calc(0.625rem+env(safe-area-inset-bottom))] dark:border-night-line dark:bg-night-surface/95">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ink dark:text-night-ink">
              {meta?.title ?? course.title}
            </p>
            <p className="text-[0.6875rem] text-ink-faint dark:text-night-faint">
              第 {Math.max(flat.findIndex((l) => l.meta.slug === lessonSlug), 0) + 1} / {flat.length} 节 · 已完成 {doneCount}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<ListTree aria-hidden className="size-4" />}
            onClick={() => setTocOpen(true)}
            className="shrink-0"
          >
            目录
          </Button>
        </div>
      </div>

      <StudyAssistant
        course={course}
        lessonMeta={meta}
        lesson={lesson}
        currentSection={currentSection}
      />
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
